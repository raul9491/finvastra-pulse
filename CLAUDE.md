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
| Database | Firestore | Project `gen-lang-client-0643641184`, **DB `pulse`** (named, Standard edition, uncapped). _Migrated 2026-06-10 from the original AI-Studio DB `ai-studio-27afcadd-…`, which had an **unliftable 50k-reads/day free-tier cap** that took the app down — see "Firestore DB Migration" below. DB id lives in `firebase-applet-config.json` (`firestoreDatabaseId`), `firebase.json` (`firestore[].database`), `server.ts` (`FIRESTORE_DB_ID`), and `scripts/**`._ |
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
├── router.tsx                       all routes; pages are React.lazy code-split chunks (lazyPage + Suspense) — preserve route paths, don't un-lazy
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
│   ├── firebase.ts                  client SDK init (emulator-aware); `ignoreUndefinedProperties: true` — Firestore strips `undefined` fields instead of throwing (forms commonly build patches with `value || undefined`)
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
│   │   ├── HrmsShell.tsx            HRMS shell — sidebar (menu search box + collapsible groups), nav badges, mobile drawer
│   │   ├── CrmShell.tsx             CRM shell — includes referral-only mode
│   │   ├── MisShell.tsx             MIS shell
│   │   └── NavItem.tsx              shared nav link primitive
│   └── ui/
│       ├── SearchableSelect.tsx     dropdown with search (+ MultiSearchableSelect)
│       ├── MultiSearchableSelect.tsx re-export shim
│       ├── ThemeProvider.tsx        dark/light mode context + ThemeToggle button (Sun/Moon)
│       ├── NotificationBell.tsx     in-app notification dropdown (bell icon)
│       ├── AppsMenu.tsx             ⊞ module switcher dropdown (HRMS/CRM/MIS → launcher); redesigned 2026-06-14 (312px, per-module accent gold/blue/green, "✓ Active" pill, hover chevron, motion open anim)
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
    │   ├── claims/        ClaimsPage (employee), AdminClaimsPage, ClaimsAnalyticsPage (spend analytics)
    │   ├── documents/     DocumentsPage (employee), AdminDocumentsPage; Firebase Storage
    │   ├── announcements/ AnnouncementsPage, AdminAnnouncementsPage (readBy tracking, pinned, priority)
    │   ├── itdeclaration/ ItDeclarationPage (employee), AdminItDeclarationsPage; 80C/80D/HRA/HomeLoan
    │   ├── compliance/    ComplianceCalendarPage (TDS/PF/PT/ESIC), PfTrackerPage + ECR export
    │   ├── letters/       HrLetterGeneratorPage (8 letter types), letterPdf.ts; Firebase Storage
    │   ├── salary/        AdminSalaryHistoryPage — salary revision history per employee
    │   ├── recruitment/   RecruitmentPage — job openings, candidate pipeline, Add-to-HRMS CTA
    │   ├── assets/        AssetsPage — laptop/SIM/card assign/return tracking
    │   ├── connectors/    ConnectorsPage — channel-partner (DSA) registry + payouts (FAC-### codes)
    │   ├── onboarding/    OnboardingPage — 20-item checklist per new employee, 4 categories
    │   ├── probation/     ProbationPage — confirm/extend/fail probation, timeline
    │   ├── offboarding/   OffboardingPage — 16-item checklist + FnF calculator + FnF PDF
    │   ├── performance/   PerformancePage (self-assessment), AdminPerformancePage
    │   ├── training/      TrainingPage (employee enroll), AdminTrainingPage
    │   ├── helpdesk/      HrHelpdeskPage (raise ticket), AdminHelpdeskPage (POSH Act compliant)
    │   ├── orgchart/      OrgChartPage — indented vertical tree (file-explorer style), collapse/expand, dept filter
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

## CRM 2.0 / Pipeline build (in progress, started 2026-06-13) — READ PLAN.md FIRST

A full approved spec (Leads → Clients → Cases 10-stage pipeline → Payout Cycles → MIS
projection → Recon) is being implemented phase-by-phase. **`PLAN.md` at the repo root is the
authoritative mapping of that spec onto this repo — read it before touching any `crm2`
code.** Three signed-off decisions OVERRIDE the original spec wording (recorded in PLAN.md
§E): **(1)** upstream aggregators live in the **`aggregators/{CONN-xxx}`** collection (NOT
`connectors/` — that name belongs to the existing Phase Q channel partners) though field
names stay `connectorId`; **(2)** permission keys are a `users/{uid}.perms` map synced into
custom claims, and ALL money fields are doc-split — `payoutCycles` + `misRecords` readable
only with `payout.amounts.read`, the case money mirror in `cases/{id}/private/payout`;
**(3)** new screens mount in CrmShell under a **"Pipeline"** nav group; old CRM screens
untouched until the migration step renames them "Archive". Hard guardrails: Firestore DB
`pulse`; FAPL-xxx (not uids) in new collections' people fields; `EncryptedField` objects via
`src/lib/encryption.ts` for PAN/bank; Aadhaar last-4 only (reject 12-digit input at API); no
AI features; all money/derived fields server-calculated; one transaction per business
mutation; mutations via Express only (`server/crm2.ts`); never break existing modules; do
not deploy — maintainer deploys.

**Progress**: Phase 0 ✅ · Phase 1 ✅ (`a481532` + gate `a68e85d`: 12/12 emulator wiring test
`.qa/crm2-phase1-gate.mjs`; claims-staleness fixed — sync-claims stamps `claimsRefreshedAt`,
AuthContext force-refreshes the token, so perm REVOKES apply instantly) · **Phase 2 ✅
(2026-06-13, NOT deployed)** — leads extension on the EXISTING collection (additive; legacy
fields untouched), `POST /api/public/leads` (no-auth intake: rate-limited 20/h/IP via
`/rate_limits`, honeypot `website` field, strict validation, UTM/formId/sourceUrl capture),
dedupe (`buildDupeKeys` in `src/lib/crm2/dedupe.ts` + 7 tests; `duplicateOfLeadId` flags,
never blocks), internal `POST/PATCH /api/crm2/leads[/:id]` (activity log arrayUnion,
CONVERTED unsettable directly), `POST /api/crm2/leads/:id/convert` — ONE transaction (all
reads incl. counters BEFORE writes — Firestore tx rule): client `CL-2026-#####` (dedupe-
reuses an existing client by dupeKey) + case `FIN-CASE-2026-####` stage OPENED + PRIMARY
applicant + idempotent docTracker expansion + stageHistory + lead links; `PARTNER_DSA` →
`SDSA-###` subDsa instead. `POST /api/crm2/perms/:uid` + perms editor UI
`/crm/pipeline/permissions`; leads UI `/crm/pipeline/leads` (funnel chips, overdue
follow-up highlight, dup banner, activity drawer, convert dialog); rules: leads read +OR
`hasCrm2Perm('crm.leads.read')`, new `clients` (+vaultDocs) and `cases` (+private/payout,
applicants, docTracker, stageHistory) blocks — client writes all denied. Migration
`scripts/migrate/normaliseCrm2Leads.ts` (DRY_RUN; legacy status/source maps; verified on
emulator). Acceptance 15/15 (`.qa/crm2-phase2-gate.mjs`) + 21 unit tests. · Phase 2 gate ✅
(`8ad2ebe`): public-leads rate limiter now reads the REAL client IP — `app.set("trust
proxy", 1)` (one Cloud Run hop) + `extractClientIp` takes the LAST X-Forwarded-For entry
(first-entry parsing is spoofable; Cloud Run appends the real IP last); 5 tests. · **Phase 3
✅ (2026-06-13, NOT deployed)** — `src/lib/crm2/stages.ts` pure fns (`validateTransition`
forward-by-one + early-CLOSED rules + DISBURSED reserved for Phase 4; `gateForStage` LOGIN
doc gate; `gatePddClear`; `computeDocsCompletePct`; +15 tests). Server endpoints: `POST
/api/crm2/cases` (walk-in open — all-reads-before-writes tx), `PATCH /api/crm2/cases/:id`
(CASE_EDITABLE_FIELDS allowlist; CASE_PROTECTED_FIELDS — stage/keyDates/docsCompletePct/
payout mirror/frozen — rejected BY NAME with 400; pddStatus→CLEARED gated), `POST
/api/crm2/cases/:id/stage` (transition + doc gate → 422 with pending list, keyDates stamp,
stageHistory append), applicants `POST/PATCH/DELETE` (PAN→EncryptedField, `aadhaarLast4`
4-digit-only + 12-digit reject, idempotent docTracker re-expansion keyed docDefId_applicantId,
DELETE keeps rows with files), `PATCH /api/crm2/cases/:id/doc-tracker/:rowId` (status +
vaultDocId reference [never copies], verifiedBy stamp, recompute docsCompletePct, stamp
keyDates.docsComplete when LOGIN docs first all VERIFIED), `POST /api/crm2/clients/:id/vault`
(base64→Storage `clients/{id}/vault/{vid}`, token URL, validUntil = now+validityDays,
REPLACED chain supersedes prior VALID). `storage.rules`: vault block read = admin or
crm.cases.read/crm.leads.read perm, write server-only. UI: `/crm/pipeline/cases` (list +
walk-in open) + `/crm/pipeline/cases/:id` workspace (10-stage stepper, read-only payout
badge, Details/Applicants/Documents[grouped by stage w/ gating]/Payout[Phase-4 placeholder]/
History tabs; vault picker references existing files; money mirror from
`cases/{id}/private/payout` shown only with payout.amounts.read). Acceptance 14/14
(`.qa/crm2-phase3-gate.mjs`: LOGIN gate proven at API, docsCompletePct live, one vault doc
on two cases, stageHistory with actors, idempotent re-expansion, Aadhaar reject, protected-
field reject, PDD-clear gate) + 40 unit tests. · **Phase 4 ✅ (2026-06-13, NOT deployed)** —
THE money pipeline. `src/lib/crm2/payout.ts` pure fns (`deriveCycleStatus` full precedence
DISPUTED→CLOSED→SUBDSA_PAID→RECEIVED→BILLED→PAYOUT_CONFIRMED→PDD_OTC_HOLD→BANKER_CONFIRMED→
CONFIRMATION_RAISED→AWAITING_DATA_SHARE — status is DERIVED, never client-set; `computeAgeing`,
`computeBankerMismatch`/`PctVariance`/`AmountVariance`=(billGross−tds)−receivedNet,
`computeNetMarginRealised`=receivedNet−subDsaPaid, `canClose`, `validateMilestoneOrder`; +16
tests). `POST /api/crm2/cases/:id/disburse` — ONE tx: validate SANCTIONED + DISBURSEMENT docs
VERIFIED + connector/lender/mapping; `resolveSlab` hard-fail on 0/>1 with the typed human
message (never 0%); FREEZE mappingId/slabId/percentages onto the case + money mirror
`cases/{id}/private/payout`; create `payoutCycles/{PC-YYYY-NNNN}` (same seq as the case) +
`misRecords/{caseId}` (id==caseId, denormalised) + stageHistory; re-reads stage in-tx to block
double-disburse. `PATCH /api/crm2/payout-cycles/:id/milestone {step:2..10,payload,override?}`
— step-order validated (out-of-order → 409 unless `override.reason`, logged in `milestoneLog`),
per-step writes, recompute status/variance/ageing/margin, ONE batch updates cycle + case
payout badge + misRecord; closure enforces `canClose`. Reads: `GET /api/crm2/payout-cycles[/:id]`,
`/api/crm2/mis`, `/api/crm2/mis/business-sheet` (xlsx server-side via `xlsx`; `share=1` stamps
`dataSharedAt/dataSharedTo/reportingMonth` on each cycle in one batch) — ALL money-stripped
without `payout.amounts.read`. `GET .../disburse-preview` powers the dialog's slab preview.
Jobs `POST /api/crm2/jobs/run-payout-reminders` (thresholds in `app_config/crm2_settings`:
reminderDataShareDays 7 / reminderBankerConfirmDays 10) + `run-vault-expiry` (validUntil<now →
vaultDoc + linked tracker rows EXPIRED) — scheduler-OIDC or admin (new `verifyScheduler` dep on
`registerCrm2Routes`). Rules: `payoutCycles` + `misRecords` read=admin||payout.amounts.read,
write=false. Indexes: `vaultDocs(status,validUntil)` CG + `docTracker.vaultDocId` override
(payoutCycles/misRecords composites front-loaded in Phase 1). UI: disburse dialog (live slab
preview), case Payout tab (10-step vertical timeline + milestone forms, money-gated, out-of-
order prompts for a reason), Payout board `/crm/pipeline/payouts` (stuck>21d / hold / dispute
filters), MIS grid `/crm/pipeline/mis` (month/connector/RM filters, xlsx export, Share action).
Pipeline nav gains Payouts + MIS. Acceptance 18/18 (`.qa/crm2-phase4-gate.mjs`: atomic
cycle+MIS, missing-slab block + no partial write, FROZEN economics, out-of-order milestone
±override, Step-8 one-batch cycle+badge+MIS, sub-DSA math, share-stamp) + 56 unit tests; all
4 gates green; jobs smoke-tested. **Next: Phase 5** (recon imports + matching, reconSnapshots,
dashboards). · **Phase 4 audit fixes ✅ (`7b973ba`)** — an independent audit caught 2 issues,
both fixed: (1) CRITICAL money leak — `GET /api/crm2/mis/business-sheet` was gated only by
`mis.read` while the xlsx carries Disbursed/Bill Gross/Received Net/TDS/Net Margin; the whole
export (download + the share action) now requires **`payout.amounts.read`** (spec §12, money
artifact). (2) MEDIUM — `run-payout-reminders` re-fired on same-day re-runs; each notify now
claims a per-cycle-per-kind-per-day marker via atomic create-if-absent on
**`crm2_reminder_logs/{cycleId}_{kind}_{YYYY-MM-DD}`** (new server-only collection;
rules read=admin, write=false — matches `/follow_up_logs`). phase4 gate extended 18→22.
New collection in the index: `crm2_reminder_logs`. · **Phase 5 ✅ (2026-06-13) — CRM 2.0
FEATURE-COMPLETE (Phases 0–5)** — reconciliation + snapshots + dashboards. `src/lib/crm2/
recon.ts` (`matchDumpRow` three-tier: loanAccountNo exact → bankApplicationNo exact → fuzzy
`dsaCode` + amount ±1% + date ±7d, inclusive boundaries, tie→smallest delta; `computeSnapshot`
period aggregation; +12 tests). Endpoints: `POST /api/crm2/recon/imports` (xlsx/csv parsed via
the existing `xlsx` dep → `bankMisImports/{id}` + `rows` subcoll, auto-match each dump row
against the connector+month misRecords, returns matched/unmatched + `missingCaseIds` = our
cases absent from the dump), `GET /api/crm2/recon/imports/:id` (rows; amounts stripped without
payout.amounts.read), `PATCH …/rows/:rowId` (manual match/unmatch), `POST /api/crm2/recon/
dispute` (sets `disputeFlag` on the missing case's cycle → status re-derived DISPUTED + case
badge + MIS, one tx), `POST /api/crm2/jobs/run-recon-snapshots` (monthly; deterministic
`reconSnapshots/{YYYY-MM_connectorId}` id → idempotent overwrite; `tdsCertificateStatus`
field), `GET /api/crm2/dashboards?period` (funnel by source/category/RM · pipeline by stage
count+value+ageing · disbursement/receivables/margin by connector/lender/product/RM/sub-DSA ·
payout health: status mix, avg disb→received, stuck>21d list · RM performance · sub-DSA
scorecard — in-process aggregation over the period's misRecords/cycles, **no rollups stored on
masters**; money sections omitted server-side without payout.amounts.read). New collections:
`bankMisImports`(+`rows`), `reconSnapshots`. Rules: bankMisImports(+rows) read=recon.read;
reconSnapshots read=payout.amounts.read; all write=false. No new composite index (the
misRecords `(reportingMonth,connectorId)` index covers the recon candidate query). UI:
`/crm/pipeline/recon` (upload dump, match table, manual unmatch, missing-cases dispute) +
`/crm/pipeline/dashboards` (all sections, money-gated); Pipeline nav gains Recon + Dashboards.
Acceptance 12/12 (`.qa/crm2-phase5-gate.mjs`): dump auto-matches by loan a/c; our missing
case → dispute list → cycle DISPUTED; snapshot idempotent (ran twice → exactly 1 doc);
receivables dashboard **per-connector ties out** to direct misRecords sums (₹1,40,000); both
dashboard and recon-row money invisible without payout.amounts.read (server-side). 68 unit
tests; all 5 gates green (12/15/14/22/12); tsc + build clean. · **Pre-deploy audit fix ✅
(`f719d16`)** — a whole-system audit found one HIGH: `POST /api/crm2/cases/:id/disburse`
echoed `expectedGross`/`finvastraPayoutPct`/`subDsaExpected` in its response to a
`payout.write`-only caller (same leak class as the Phase 4 business-sheet). Fixed — those
money fields are returned only when the caller also holds `payout.amounts.read` (else just
`{ok, cycleId}`; the figures are readable via the money-stripped `GET /api/crm2/
payout-cycles/:id`), mirroring the milestone endpoint. phase4 gate 22→24 (with + without
amounts); all 5 gates green (12/15/14/**24**/12). Deploy order when the maintainer
ships: `deploy:rules` → verify → `deploy:indexes` → `firebase deploy --only storage` → Cloud
Run (`--no-cpu-throttling`) → hosting → seed script (documentMaster + masters) → register Cloud
Scheduler jobs (run-payout-reminders + run-vault-expiry daily, run-recon-snapshots monthly) →
grant perms via Permission Manager → load real DSA-code mappings + slabs.

### CRM 2.0 — DEPLOYED TO PRODUCTION ✅ (2026-06-13)
Staged deploy run in the safe order: `deploy:rules` (released to `cloud.firestore`) → `deploy:indexes` (deployed for **pulse** database; **66/66 composite indexes READY**) → `firebase deploy --only storage` (vault rules released) → `gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling` (**revision `pulse-api-00040-2rp`**, 100% traffic) → `npm run deploy` (build:prod tsc-gated + `target:apply hosting pulse` + hosting release). **`npm run verify:deploy` 3/3 green**: app shell `pulse.finvastra.com` 200, API+DB deep-health 200 (real Firestore read), rules bound to `pulse` with real content (ruleset `c67c5bb7…`). HEAD at deploy: `c59bc2a`.

**Post-deploy config status:**
- ✅ **Cloud Scheduler jobs registered & ENABLED (2026-06-13)** — `crm2-payout-reminders` daily `0 4 * * *` (09:30 IST) · `crm2-vault-expiry` daily `15 4 * * *` (09:45 IST) · `crm2-recon-snapshots` monthly `0 2 1 * *` (1st, 07:30 IST). All asia-south1, Etc/UTC, OIDC SA `787616231546-compute@developer.gserviceaccount.com`, audience = full URI, hitting `/api/crm2/jobs/run-*`. `crm2-vault-expiry` force-run smoke-tested → **Cloud Run 200** (OIDC auth verified end-to-end). Manage: `gcloud scheduler jobs run|pause|describe crm2-* --location=asia-south1`.
- ⏳ **Seed masters — STILL PENDING (needs maintainer's creds).** `npx tsx scripts/seed/seedCrm2Masters.ts` seeds 28 `documentMaster` docs (idempotent) + optional lenders/products from `scripts/seed/crm2-masters.json` (only the `.template.json` exists). Requires `GOOGLE_APPLICATION_CREDENTIALS` → a service-account JSON the maintainer holds locally (none committed; no ADC in this env) — **Rahul must run this on his machine.**
- ⏳ **Grant CRM 2.0 perm keys** via Permission Manager to the relevant users.
- ⏳ **Load real DSA-code mappings + slabs** — disbursement hard-fails with no slab (fails safe), so nothing breaks silently; but **no payout cycle can be created until slabs exist.**

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
| `lead_convertor` | Closes deals. `ownerId` on the opportunity (set when transferred). Vertical-specific: **`convertorVerticals` is required (≥1)** — a multi-select of `loan` / `wealth` / `insurance` (one convertor can cover several lines, e.g. loan + insurance). Set as tick-pills alongside crmRole in Permission Manager (or the Employees edit modal). Legacy single `convertorVertical` is still read as a fallback and cleared on next save. Handoff matching (`TransferModal`, `transferOpportunity`) checks `convertorVerticals.includes(opportunityType)`. |
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
- **`SuperAdminPermissionsPage.tsx`** (`/hrms/admin/permissions`, super admin only) — Single permission interface for all 25 employees. Super admin rows shown read-only at top with gold `SUPER ADMIN` badge + lock icon. All dropdowns/toggles locked on SA rows. "Fix Ajay's Permissions" button auto-shown when his permissions mismatch canonical values (disappears once Firestore updates via onSnapshot). **Role is a segmented Employee | Admin control; Convertor verticals are multi-select tick-pills** (Loan/Wealth/Insurance — pick ≥1, amber warning if none) appearing when CRM Role = Convertor (redesigned 2026-06-09 for tick-based ease). "Super Admins" filter chip isolates SA rows. Column header tooltips on hover.
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
- ~~❌ Real-time collaboration features~~ — **partially lifted (Phase P, 2026-06-11, approved by Rahul)**: lightweight real-time **presence** ("also viewing" chips on lead/opportunity pages) is now in scope. Anything heavier (co-editing, live cursors, chat) remains out of scope.

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
| 3 | ✅ **DONE (2026-06-10) — Role checks read custom claims first** — all role helpers in `firestore.rules` check `request.auth.token.<claim>` first (stamped by sync-claims) with `get()` only as `||` fallback; eliminates the per-request `/users` read for tokens carrying claims. See "Firestore DB Migration + Read-Reduction". | ✅ Resolved | 6 | `firestore.rules` |
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

### Bundle / code splitting (2026-06-08)

Route-based code splitting — **no logic changes**, pure build optimisation.

- **`src/router.tsx`** — every module page + the 3 shells are now `React.lazy` chunks via a `lazyPage(loader, key)` helper (pages are named exports, so it maps the chosen export onto `default`). Each lazy element is wrapped in its own `<Suspense fallback={<RouteLoader/>}>` (helper `s()`), so the shell nav stays mounted while a page chunk loads. **Auth pages (Login/ResetPassword/AuthAction/RequestAccess), LauncherPage, and CustomerTrackerPage stay static** (must be instant).
- **`vite.config.ts`** — `build.rollupOptions.output.manualChunks`: `vendor-firebase` (app/auth/storage), `vendor-firestore` (firestore alone — it's the bulk), `vendor-pdf` (jspdf), `vendor-ui` (`motion` + lucide-react), `vendor-react` (react/dom/router).
- **`src/styles/glass.css`** — added `@keyframes spin` for the route loader.

**Before → After** (main entry):

| | Raw | Gzip |
|---|---|---|
| Before — single `index.js` | 3,115 kB | 796 kB |
| After — `index.js` entry | 279 kB | **86 kB** |

After: largest chunks are `xlsx` 419 kB (dynamic, import pages only), `vendor-pdf` 412 kB / 134 kB gz (PDF generation only), `vendor-firestore` 399 kB / 100 kB gz, `vendor-firebase` 209 kB / 44 kB gz, `vendor-ui` 147 kB, `vendor-react` 102 kB; every page is its own 15–85 kB chunk loaded on navigation. **No chunk exceeds 500 kB.** ~89% smaller initial download.

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
| **Claims & Reimbursements** | ✅ Complete | `src/features/hrms/claims/ClaimsPage.tsx`, `AdminClaimsPage.tsx`, `src/features/hrms/hooks/useClaims.ts`. **Bill/receipt upload (2026-06-09)**: employee attaches an image or PDF on the New Claim form → **images compressed client-side** (`src/lib/imageCompression.ts`, canvas resize→JPEG, max 1600px / q0.7; PDFs pass through, both capped 10 MB) → uploaded to Storage `claim-receipts/{uid}/…` with a progress bar → URL saved to `receiptUrl` (via `submitClaim({ ...receiptUrl })`). "View bill" link shown on the employee row + the Admin Claims table. Compressing in-browser means the large original never uploads — Storage stays tiny (well inside the 5 GB free tier). **Enhancements (2026-06-09)**: categories now `travel · medical · petrol · client_entertainment · cibil · software · office_supplies · other` (`NEW_CLAIM_TYPES` in the form; **`mobile` retired** from new claims but kept in `CLAIM_TYPE_META` so old claims still render); bill upload box supports **drag-and-drop**; new **`expenseDate`** field (datetime-local — "Bill Date & Time", capped at now) on the claim for spend-by-month analysis. **Admin: rows are clickable → `ClaimDetailModal`** (theme-aware `glass-modal-*`) showing the **embedded bill** (image inline / PDF link, detected via `.pdf` in the URL), all details (amount, description, bill date/time, spend month, route), and **Approve / Reject inline** (Reject reveals a required reason textarea); the old per-row ✓/✗ buttons + `RejectModal` were replaced. For **approved** claims the modal also has **Mark as Paid** (single-claim — reveals a short payment-reference/note textarea → `handleMarkPaid` → `markClaimsPaid([id], ref)` + paid notification/email); the **bulk** checkbox → Mark-as-Paid flow stays for batches. `ClaimType` gained `cibil`/`software`/`office_supplies`; `Claim.expenseDate?: string`. **Spend analytics (2026-06-09)**: `ClaimsAnalyticsPage` at **`/hrms/admin/claims-analytics`** (Payroll & Finance nav, admin/HR) — pure client-side aggregation of `useAllClaims()` grouped by the **bill month** (`expenseDate`, falls back to submission date): summary cards, **by category** (bars), **by month** (12-bar chart), **top spenders**, year selector + "Approved+Paid vs All claimed" basis toggle + CSV export. This is what `expenseDate` was added for. |
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

> **Rebuilt 2026-06-09 to the firm's CA Compliance Calendar FY 2026-27** (`Finvastra_Compliance_Calendar_FY2627.pdf`). The old seed had wrong dates (PT was month-end, ESI was 21st, PF annual was in March) and tracked only 7 obligations. Now **due-month convention** — opening a month lists everything *due in that month* (matching the CA's table layout); the recurring monthly deposits/returns are for the **previous** month's period (e.g. April shows March's TDS/PF/PT/ESI).

**Data model** (`src/types/index.ts`): `ComplianceType` is now a **category** — `tds | gst | income_tax | pt | pf | esi | mca | payroll` (drives icon/colour); the specific obligation is stored in the new `ComplianceRecord.title` field. Legacy records (old per-item types like `tds_deposit`) render via a `FALLBACK_META` so they don't break.

**Seed (`generateComplianceItems`) — full FY 2026-27 schedule:**
- **Every month** (for the prior period): TDS deposit (7th), GSTR-1 (11th), GSTR-3B (20th), PT deposit + return (10th), PF deposit (15th), ESI deposit (15th)
- **April**: TDS special deposit (30th), PT Annual Return Form V (10th), ESI Half-Yearly Form 5 / Oct–Mar (11th)
- **May**: TDS Return Q4 (31st), TCS Return Q4 (15th), 15G/15H Q4 (15th), PF Annual Return Form 3A/6A (31st)
- **June**: Advance Tax 15% (15th), Board Meeting Q1
- **July**: ITR non-audit (31st), TDS Return Q1 (31st), TCS Return Q1 (15th), 15G/15H Q1 (15th)
- **September**: Advance Tax 45% (15th), Tax Audit Report (30th), DIR-3 KYC (30th), AGM (30th), Board Meeting Q2
- **October**: ITR-6 audit (31st), TDS Return Q2 (31st), TCS Return Q2 (15th), 15G/15H Q2 (15th), ESI Half-Yearly Form 5 / Apr–Sep (11th), ADT-1 (15th), AOC-4 (30th), MGT-14 (30th)
- **November**: MGT-7 Annual Return (30th)
- **December**: GSTR-9 Annual (31st), Advance Tax 75% (15th), Board Meeting Q3
- **January**: TDS Return Q3 (31st), TCS Return Q3 (15th), 15G/15H Q3 (15th), ESI Annual Return Form 5 (31st)
- **March**: Advance Tax 100% (15th), Board Meeting Q4, Reconcile Annual PF, Payroll Year-End Audit, Form 16/16A prep (all 31st)
- **February / August**: monthly recurring only

Status computation (unchanged): `filed` (filedAt non-null) · `overdue` (dueDate < today, unfiled) · `due_soon` (≤7 days) · `upcoming`.

**Two views (toggle, top-right) — `Calendar` (default) / `List`:**
- **Calendar** — a Mon-start month grid (`CalendarGrid`); each obligation sits on its **due date** as a colour-dot chip (dot colour = status: red overdue · amber due-soon · slate upcoming · green filed-with-strikethrough); a day cell shows up to 3 chips + "+N more" and a count badge; today is gold-ringed, overdue days red-bordered, all-filed days green. **Click any day → `DayDetailModal`** listing every filing due that day (reuses `ComplianceCard` → Mark-as-Filed / View inline). Legend strip at the bottom.
- **List** — the original status-sorted card grid (overdue → due-soon → upcoming → filed).

**Deterministic IDs + reconcile (no duplicates, self-healing).** Each obligation is stored under a **deterministic doc id** `cmp_{YYYY-MM}_{category}_{slug(title)}` via `setDoc` — so the same filing always maps to **exactly one** document and re-seeding can never duplicate it. (The earlier `addDoc` random-id seeding, across the original + two rebuilds, left duplicate rows → the same filing showed twice; this fix de-dups them.) On opening a month, `loadRecords` reconciles: (1) create any expected obligation that's missing — unless a **filed** row already covers it (matched by `contentKey = type|title|dueDate`); (2) refresh only **stale UNFILED** canonical rows (`seedVersion < SEED_VERSION`); (3) **delete leftover UNFILED rows not in the current schedule** (old-convention / random-id duplicates). **Filed rows are always preserved** as history. A settled month does zero writes. Backed by a rules change: `/compliance_records` `allow delete: if isAdmin() || isHrmsManager()` (was `if false`; operational reminders, not legal-retention records). `SEED_VERSION` (currently `2`) only gates the stale-unfiled refresh; the id-based dedup/cleanup runs every load regardless. Bump it when `generateComplianceItems` changes.

**Key Dates table** at the bottom: clean two-column table (Obligation · Due dates) with **all due dates in red**, summarising the CA's rules (TDS 7th, PT 10th, PF 15th, ESI 15th, GST 11th/20th, Advance Tax %, TDS returns quarterly, AGM/ADT-1/AOC-4/MGT-7 windows, board-meeting 120-day rule, salary 1st–7th).

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

### Leave-balance correctness fixes (2026-06-11)

Four bugs that made balances "off", all in the same flow:

1. **`approveLeave` seeded `total: 0`** when the balance doc/type entry didn't exist — once the doc existed, the UI's `?? 8` fallback never applied again, so employees showed 0 totals / 0 remaining forever. Now seeds from `LEAVE_DEFAULT_TOTALS` (CL 8 · SL 7 · EL 15 · comp_off 0) exported from `useLeave.ts`.
2. **`cancelLeave` never refunded** — cancelling an APPROVED leave left `used` inflated. Now decrements used/recomputes remaining for tracked types.
3. **Partial balance docs crashed readers** — a doc with only `comp_off` (created by a comp-off grant) blew up `balance?.casual.used` on LeavePage and `balance[type]!.remaining` on ApplyLeavePage. All per-type reads are now optional-chained with handbook defaults.
4. **Year convention unified to FINANCIAL year** via `currentLeaveYear()` in `useLeave.ts` (April→current year; Jan–Mar→previous), matching the Phase G year-end reset job. Previously LeavePage/ApplyLeavePage/AdminLeavePage/approveLeave used the CALENDAR year, which would split each FY's balance across two docs every Jan–Mar. Call sites switched: LeavePage, ApplyLeavePage, AdminLeavePage (BalancesTab), AdminCompOffPage (display + grant uses FY of dateWorked), approveLeave, cancelLeave. **Rule: any new code touching `/leave_balances` must use `currentLeaveYear()` — never `new Date().getFullYear()`.**

### Theme flash fix (2026-06-11)

Light-mode users saw a **dark flash on every load/refresh** (ThemeProvider only applies the `light-mode` body class after React mounts; more visible since the PWA made loads faster). Fixed with a tiny inline **pre-paint script in `index.html`** that reads `localStorage('fv-theme')` and sets the html background + body class (via MutationObserver before parse completes) + theme-color meta before first paint. Keep this script inline and tiny; don't move it into the bundle.

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
**Data source**: each active employee's manager, resolved in this order: `reportingManagerUid` → legacy `managerId` → **`reportingManagerName` matched against employee display names** (case-insensitive name fallback, so records that saved only the manager's name still link). Set from the **Employees page** — both the Add Employee modal and the edit-employee modal have a **Reporting Manager** `SearchableSelect`.

> **Fixed 2026-06-08 (two bugs):** (1) the chart read only `managerId`, which the UI never wrote → repointed to `reportingManagerUid` + name fallback. (2) `POST /api/admin/employees/create` and `/api/hrms/employees/create` saved only `reportingManagerName` and **dropped `reportingManagerUid`**, so newly-added staff never linked → both endpoints now persist the uid. The bulk importer still saves name-only, which the chart's name fallback covers without a migration.

- Root: Ajay Newatia (FAPL-000, UID `3zdX5QBnTbQAcTdLzUjfXxefP8r2`)
- Employees whose manager can't be resolved by uid or name attach directly under root
- **Inactive managers are dropped** (only active employees are in the tree), so their reports fall back under root. To prevent assigning anyone to a manager who has left, the **Reporting Manager dropdown now excludes inactive employees** (Add Employee modal + Employees edit modal, 2026-06-08). _Gotcha seen in the wild: 3 reports were assigned to an inactive lead with a name very close to an active one (“Dadapuram Hima Bindu” vs “M Hemadri Babu”) and silently dropped to root._
- Max depth: 10 (guards against circular references in bad data)
- **Layout: indented vertical tree** (file-explorer style) — grows top-to-bottom only, **no horizontal scrolling**, fits any screen however many reports a manager has (replaced the old wide horizontal card tree on 2026-06-08, which forced two-axis scrolling and pushed the root off-screen)
- Collapse/expand per node (chevron at the left of each row); Expand All / Collapse All; Collapse All keeps the root row visible
- Department filter (dropdown + legend chips): shows subtree containing matching employees, preserving ancestor chain
- Each row: chevron (if reports) · avatar initial (or photo) in dept colour · name · emp-code badge · dept badge · designation · report count; children indented under a guide line
- No external chart library — recursive `OrgRow` component, capped at `max-w-3xl`

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

## Phase S — CRM Meetings→Calendar, Team Status + Manual Remap, Sidebar Cleanup (2026-06-13)

Client-feedback build. **DEPLOYED TO PRODUCTION ✅ (2026-06-14)** — merged to main (`5b96fcb`), staged deploy: rules (ruleset `99af7224`) → verify → indexes (2 new `crm_meetings` composites **READY**) → Cloud Run **`pulse-api-00041-8qx`** (`--no-cpu-throttling`, 100%) → hosting → `verify:deploy` 3/3 green → Cloud Scheduler **`crm-meeting-reminders`** ENABLED (every 15 min; force-run → Cloud Run 200). All deterministic — no AI. **Part A calendar sync is now LIVE & verified end-to-end (2026-06-14):** the Workspace-admin DWD scope `calendar.events` was granted AND the **Google Calendar API was enabled on the project** (`gcloud services enable calendar-json.googleapis.com` — it had been disabled, which would have failed every insert with `SERVICE_DISABLED` despite the scope grant). Verified by an impersonated `events.insert`+`events.delete` on a real `@finvastra.com` calendar via the Gmail DWD SA.

### Part A — Meetings on a customer → the SCHEDULER's own Google Calendar (company-wide)
**Any CRM user** (not just the RM) schedules client meetings ("Wed/Fri meeting") on a customer; the server pushes each to **that scheduler's own Google Workspace calendar** (and phone). The customer's RM is added as a **calendar guest** + bell'd when they aren't the scheduler, so the owner stays in the loop. _(Widened 2026-06-14 from RM-only — rev `pulse-api-00042-mwz`.)_
- **New collection `/crm_meetings/{id}`**: `leadId, leadName, ownerId (=the SCHEDULER, == createdBy), ownerEmail, leadOwnerId (the customer's RM/guest), title, startAt (ISO), endAt, location?, notes?, status: scheduled|done|cancelled, calendarEventId?, calendarSyncStatus: synced|failed|skipped, reminderSent?, createdBy/Name, createdAt, updatedAt`. Rules: **read = admin || `hasCrmAccess()` || `isManagerOf(ownerId)`** (company-wide — a meeting is just a customer ref + a time; shows on the customer's meeting list to whoever's working it); **write = false** (server-only via Admin SDK, so the doc and the calendar event stay in lockstep).
- **Calendar write** reuses the existing **Gmail domain-wide-delegation SA** — `getCalendarClient(subjectEmail)` in `server.ts` builds a `JWT` with scope `calendar.events` impersonating the **scheduler's** email → `calendar.events.insert` on their `primary` calendar (`Asia/Kolkata`, 30-min popup+email reminders, RM added to `attendees` with `sendUpdates`). **Non-fatal**: meeting always saves; on failure `calendarSyncStatus:'failed'` and the UI shows "not synced". Mirrors the leave→calendar pattern.
- **Endpoints** (`server.ts`): `POST /api/crm/meetings` (authz: **admin || `crmAccess`** — any CRM user; event on the scheduler's calendar + RM as guest; writes doc + `meeting` activity + bell to the scheduler and to the RM if different), `PATCH /api/crm/meetings/:id` (reschedule/done/cancel by admin || ownerId || createdBy || manager; mirror event patch/delete). **Reminder job** `POST /api/admin/run-meeting-reminders` (admin/scheduler) fires bell+email ~30 min before `startAt` to the scheduler, deduped via `reminderSent` — Cloud Scheduler job **`crm-meeting-reminders`** every 15 min (registered & ENABLED 2026-06-14).
- **Indexes**: `crm_meetings (ownerId ASC, startAt ASC)` + `(leadId ASC, startAt DESC)`.
- **UI**: `MeetingsSection` on `LeadDetailPage` (schedule form + upcoming/past list + sync chip + done/cancel); **`/crm/meetings`** "My Meetings" page (`MyMeetingsPage`, grouped Today/Tomorrow/This week/Later); hook `src/features/crm/hooks/useMeetings.ts` (`useLeadMeetings`, `useMyMeetings`, `scheduleMeeting`, `updateMeeting`). Types `CrmMeeting`/`CrmMeetingStatus`/`CalendarSyncStatus`.
- **✅ Prerequisites DONE (2026-06-14) — calendar sync verified live.** Two things were needed (both done): (1) Workspace Admin → Security → API Controls → **Domain-wide Delegation** → scope **`https://www.googleapis.com/auth/calendar.events`** added to the SAME SA client ID already authorised for Gmail; (2) **Calendar API enabled on the project** — `gcloud services enable calendar-json.googleapis.com` (it was disabled; the scope alone is NOT enough — inserts 403'd with `SERVICE_DISABLED` until the API was turned on). _Gotcha for any future Google-API-via-DWD feature: granting the DWD scope and enabling the API are TWO separate steps; both required._

### Part B — Team Status View + manual reassignment (managers + super admins)
A place for managers (own team) and super admins (all teams) to **see each rep's lead statuses** and **manually** reassign — nothing automatic.
- **Server** (`server.ts`): `computeTeamSummary` now adds a per-member **status breakdown** (counts by `leadStatus`) + `lastActivityMs`. `GET /api/crm/team/performance` gains optional `?managerUid=` (honoured **only for admins** → super admin views any team). New `GET /api/crm/team/all` (admin-only) lists managers (≥1 direct report) for the team picker.
- **UI** (`TeamPerformancePage`, `/crm/team`): admin/super-admin **team picker** (all teams); member table gains a **"Status of their leads"** chip column + last-activity; per-row **Manage** → `MemberLeadsModal` loads that rep's leads (status, callback, "Nd with owner") with multi-select + **Reassign to teammate**. Reassign is a chunked `writeBatch` (≤150 leads/batch): `primaryOwnerId` + `assignedToCurrentOwnerAt` + field_history(`primaryOwnerId`) + a `status_change` activity per lead, then one aggregated bell to the new owner. Rules already permit it: `isManagerOf(currentOwner)` (manager) or `isAdmin()` (super admin) — a manager can only move his own reports' leads.
- **New informational field `Lead.assignedToCurrentOwnerAt`** — set on **every** ownership change (createLead, single reassign `LeadDetailPage`, bulk reassign `LeadsPage`, import `distributeBatch`). Drives the "Nd with owner" column. **No automatic action keyed off it.** Added to the leads `update` rule `hasOnly` key list.

### Part C — CRM sidebar regroup + collapse (`CrmShell.tsx`)
Cut clutter: a collapsible `NavGroup` component; nav reorganised into **Dashboard** (top) · **Workspace** (My Queue, Customers, Meetings, Commissions, Targets) · **Pipeline (CRM 2.0)** (perm-gated, unchanged) · **Team** (Command Centre, My Team, Lead Aging, Import, Import Queue — managers/admins) · **Admin & Config** (the 12 admin pages, **collapsed by default**, admin only). No features removed; routes/permissions unchanged; "NOTHING LOCKED" preserved. HRMS/MIS sidebars untouched this round.

### Deploy notes (when maintainer ships this branch)
Standard order: `deploy:rules` → verify → `deploy:indexes` (2 new `crm_meetings` composites) → Cloud Run `gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling` (Part A/B server changes) → `npm run deploy` (hosting) → `npm run verify:deploy`. Then: **(1)** grant the Workspace DWD Calendar scope (Part A prereq above); **(2)** register Cloud Scheduler `crm-meeting-reminders` (every 15 min → `/api/admin/run-meeting-reminders`, asia-south1, OIDC SA, like the other jobs).

**New collection**: `crm_meetings`. **New routes**: `/crm/meetings`. **New endpoints**: `POST/PATCH /api/crm/meetings[/:id]`, `GET /api/crm/team/all`, `POST /api/admin/run-meeting-reminders`; `GET /api/crm/team/performance` gained `?managerUid`.

---

## Phase T — Learning & First-Run Guided Tours (HRMS · CRM · MIS) (2026-06-14)

OS-style onboarding: the first time a user opens a module, a **spotlight coachmark tour** dims the screen and highlights the real sidebar items one at a time (skippable); afterwards it never auto-shows again (remembered **per user, cross-device**), and every module has a **"Learn" tab** to replay the tour and browse a full reference of what each tool does. Custom-built on `motion` (no tour library); all deterministic, no AI. **DEPLOYED TO PRODUCTION ✅ (2026-06-14)** — merged to main (`5dc57d5`); `deploy:rules` (ruleset `1f4d2819`, the `onboarding` self-write key) → `verify:deploy` → `npm run deploy` (hosting) → `verify:deploy` 3/3 green. No server/index/Cloud Run change.

### Engine — `src/features/learn/`
- **`TourProvider.tsx`** — context (`startTour/next/back/end`), mounted in `App.tsx` inside `AuthProvider` (wrapping `ToastProvider`); renders `<TourOverlay/>` over everything. Writes the seen-flag on finish/skip. Exposes `stepMode(step)` (`'card'|'skip'|'spotlight'`).
- **`TourOverlay.tsx`** — the spotlight: box-shadow-cutout highlight on the target element (`[data-tour="…"]`) + a tooltip card (title/body/Back/Next/Skip + progress dots). Recomputes rect on scroll/resize; Esc/✕ = skip, ←/→/Enter navigate. **Graceful degradation**: target **not in DOM** (a tool the user lacks access to — shells omit it) → **step skipped**; target in DOM but **hidden** (desktop sidebar on a phone) → **centered card**; no target → centered card (welcome/closing). One step list is therefore role-aware + mobile-safe. _Centering fix (`827b81a`, deployed 2026-06-14): no-target cards render inside a flex-centered container (NOT a CSS `translate(-50%,-50%)`, which the entrance-animation transform was clobbering → card drifted off-centre); capped at `maxWidth:92vw` for phones/PWA + a transparent click-blocker. Same fix applies to the installed PWA (identical bundle)._
- **`tourSteps.ts`** — `TOURS: Record<'hrms'|'crm'|'mis', TourStep[]>` (the drafted copy). **`useTour.ts`** — `useTour()` + `useAutoStartTour(module)` (each shell calls it; auto-starts ~700 ms after paint when `profile.onboarding[module]` is falsy, useRef + localStorage guard).
- **`LearnView.tsx`** — generalised from `PulseGuidePage` (accordion + search) + a prominent **"▶ Take the guided tour"** button. Sections can carry an optional `show(ctx)` gate (hides admin-only sections). Content in **`content/{crm,mis}.tsx`** (HRMS reuses `PulseGuidePage`'s existing `SECTIONS`).

### Persistence (cross-device)
- **`UserProfile.onboarding?: { hrms?, crm?, mis? }`** (`types/index.ts`) + new `LearnModule` type. On finish/skip: `updateDoc(users/{uid}, { onboarding: {…, [m]: true} })` (fire-and-forget; live profile listener reflects it) + a `fv_tour_{module}_{uid}` localStorage fast-path.
- **`firestore.rules`** — added `'onboarding'` to the `/users/{uid}` **self-update** `hasOnly([...])` allow-list (the only rule change; users can mark their own tour done, nothing else).

### Pages / nav / routes
- **Routes**: `/crm/learn` (`CrmLearnPage`), `/mis/learn` (`MisLearnPage`); HRMS keeps `/hrms/guide` (now powered by `LearnView`). Nav: "Learn" item added to CRM **Workspace** group + MIS `NAV`; HRMS "Pulse Guide" stays. Each Learn nav item carries `data-tour="learn"` (the tour's closing step points there).
- **`data-tour` anchors** added to nav items in all 3 shells (e.g. `crm-customers`, `crm-meetings`, `hrms-attendance`, `mis-reconciliation`). Pure attributes — no behaviour change. `NavItemLive`/`navLink`/MIS `NavLink` gained an optional `dataTour`.

### Files
**New** `src/features/learn/`: `TourProvider.tsx`, `TourOverlay.tsx`, `useTour.ts`, `tourSteps.ts`, `LearnView.tsx`, `types.ts`, `content/{crm,mis}.tsx`; `src/features/crm/learn/CrmLearnPage.tsx`; `src/features/mis/learn/MisLearnPage.tsx`. **Modified**: `App.tsx`, `types/index.ts`, `firestore.rules`, `router.tsx`, `PulseGuidePage.tsx` (→ `LearnView`), the 3 shells. tsc + build clean; rules compile. **Deployed 2026-06-14 (rules + hosting only).**

---

## CRM 2.0 Business-Requirements Update (doc "New Updated as on 14-06-2026") — multi-phase

Big approved initiative refining CRM 2.0 (plan: `~/.claude/plans/eager-noodling-floyd.md`). **5 modules** (HRMS · CRM & Leads · MIS · Command & Compliance Center · LMS). Confirmed decisions: terminology rename (labels only — collections/`connectorId` field unchanged): **Aggregator**=`aggregators`(CONN-###) · **Connector**=`subDsas`(SDSA-###) · **Sub DSA**=HRMS `connectors`(FAC-###). Two-step funnel Customers→Leads→**Client Master**(FCL-####)→Cases. **Per-login model** (KEY, Phase 4): case stages 1–3 are case-level; from Stage 4 each *login* runs its own login→sanction→disburse→PDD and makes its own payout cycle + MIS record. Stage order: Opened · Basic Docs+Eligibility · Docs · File/Bank Login · Code+login done · In Process · Sanctioned/Rejected · Disbursement · PDD/OTC · Completed. Data-entry decoupled from stage advancement. Phasing: 1 rename+IA+modules+MIS-move → 2 Client Master+convert wizard → 3 Customers→Leads move+Leads rework → 4 case pipeline rebuild (per-login, heaviest) → 5 master expansions → 6 Tasks/collaboration.

### Phase 1 ✅ DEPLOYED (2026-06-15, hosting-only — merged `4715f43`; **zero backend/rules/index change** confirmed by diff, ruleset unchanged `1f4d2819`, 68/68 crm2 unit tests pass, verify:deploy 3/3) — rename + IA + 5-module launcher + MIS move
- **1a rename (labels only)**: CRM masters tab "Connectors"(aggregators)→**Aggregators**, "Sub-DSAs"(subDsas)→**Connectors**; MappingsTab + case Details + PayoutTab labels; HRMS Connectors page/nav/search + old-CRM "Sourced by Connector" pickers (NewLead/AddOpportunity/QuickAdd/LeadDetail/OpportunityDetail) + MIS disbursals column → **Sub DSA**. `connectorId`/`aggregators`/`subDsas`/`connectorCode` identifiers untouched.
- **1b CRM sidebar → doc IA** (`CrmShell.tsx`): Dashboard · Workspace(**Tasks**, Targets) · **Customers** · Pipeline(**Leads · Clients · Cases**) · Teams(My Team, Reports, Import, Import Queue) · Admin(Masters, Permissions, CRM 2.0 Dashboards, legacy config — collapsed, admin). My Queue+Meetings folded into Tasks; Learn→LMS; Command Centre→Command&Compliance module; Commissions + MIS/Recon/Payouts → MIS module.
- **1c MIS move** (`router.tsx`, `MisShell.tsx`): CRM 2.0 financial pages now at **/mis/cases-mis** (MisGridPage), **/mis/recon** (ReconPage), **/mis/payout-cycles** (PayoutBoardPage) as primary; old MIS (Overview/Statements/Reconciliation/Disputes/RM-Payouts/Slabs/Templates) + old-CRM Commissions (**/mis/commissions**) under an "Archive · old MIS" section. Removed orphaned `/crm/pipeline/{mis,recon,payouts}` routes (Dashboards stays in CRM).
- **1d minimal pages**: `Crm2ClientsPage` (/crm/pipeline/clients — read-only client list, full master Phase 2); `TasksPage` (/crm/tasks — tabbed My Queue + Meetings, collaboration Phase 6).
- **1e 5 modules**: standalone landings **/command** (`CommandCompliancePage`) + **/lms** (`LmsPage`) link existing pages; LauncherPage 5-tile grid + AppsMenu entries.
- **Legacy old-CRM config REMOVED from CRM Admin nav** (Commission Slabs, Providers & SLA, Document Types, Eligibility Rules, Rate Memory) — CRM 2.0 Masters supersedes them; their routes are kept (old CRM still reads that config) but unlisted. Admin nav now: Masters · Permissions · CRM 2.0 Dashboards · Import History · Commission Leakage · Competitor/Referral Intel · Access Logs · Right to Erasure · Webhooks.
- _Reversible nav choices (open for review)_: Targets under Workspace (RMs keep own-targets); CRM 2.0 Dashboards under Admin pending the Dashboard merge (Rahul wants the CRM Dashboard + CRM 2.0 Dashboards merged, share-gated, managers see team data without a share — a Phase-2 content task).

### Phase 2 ✅ DEPLOYED TO PRODUCTION (2026-06-15) — Client Master + Lead→(resolve client)→Case convert wizard
The funnel's spine. **New client IDs are now `FCL-2026-#####`** (was `CL-`). tsc + build clean; all 5 emulator gates green except one environmental failure (P1 12 · **P2 27** · P3 13/14 — the single fail is the vault-upload step needing GCS ADC creds, absent in the sandbox, NOT a logic regression · P4 24 · P5 12); 68/68 unit tests pass. **Merged to main (`ddc6658`); staged deploy:** `deploy:rules` (already-current, released to `cloud.firestore`) → `deploy:indexes` (new `cases(clientId,createdAt)` composite built **READY** on `pulse`) → `gcloud run deploy pulse-api --no-cpu-throttling` (**revision `pulse-api-00043-zgl`**, 100% traffic) → `npm run deploy` (hosting) → `verify:deploy` **3/3 green**; live smoke-check `POST`/`PATCH /api/crm2/clients` return **401** (routes registered, auth-gated). HEAD at deploy `e6b0bd7`.

> **⚠️ Live-data correction (2026-06-15):** the long-standing "CRM 2.0 has no live cases/slabs" note was **STALE** — production already holds **3 clients (`CL-2026-0000{1,2,3}`) + 3 cases** (`counters/clients-2026` seq=3; `dsaCodeMappings`/`payoutCycles` still empty). Phase 2 is non-destructive to them: the `FCL-` prefix only affects **newly-minted** clients (next is `FCL-2026-00004`), legacy `CL-` clients keep their ids and are read by id, everything else is additive — **mixed `CL-`/`FCL-` ids coexist**. The convert wizard's paste-box resolve accepts BOTH `CL-` and `FCL-` (commit `e6b0bd7`). **This is a real flag for Phase 4** — its stage-order reshaping is NOT free; those 3 live cases sit on the OLD stage machine and will need a migration/back-fill. Re-verify counts before Phase 4.
- **Backend (`server/crm2.ts`)** — `sanitizeClient(body,isCreate)` validates the full §4.1 template (constitution enum, name, industry, PAN raw→`panEnc`/`panLast4`, gstin/udyam/cin, incorporationDate, nested `regAddress`/`commAddress`, `primaryContact{name,mobile(10-digit),email}` → recomputes `dupeKeys`, `latestCibil`, `existingRelationships[]`, kycStatus, status; `rejectFullAadhaar`). New `getCallerMeta(uid)` → `{isAdmin, isManager(crmRole==='manager')}`. **`POST /api/crm2/clients`** (perm `crm.cases.write`; mints `FCL-${year}` via `counters/clients-${year}`; `ownerRm` = caller's FAPL, admin may pass explicit; `sourceLeadId:null`). **`PATCH /api/crm2/clients/:id`** — splits **privileged keys (`ownerRm` assign-RM, `status` blacklist → admin/manager only, else 403)** from detail edits (admin OR `ownerRm===caller.fapl`, else 403). **Convert extended** (`POST /api/crm2/leads/:id/convert`): accepts a **`newClient` object** (§4.1 → mints a fresh `FCL-` client, short-circuits dedupe), still honours `clientId` (reuse existing) and the legacy dedupe→create-from-lead fallback; one transaction as before. Client minting in the convert tx switched `CL-`→`FCL-`. Clients stay **server-only writes** (no rules change).
- **Frontend (`src/features/crm2/clients/`)** — **`ClientFormModal.tsx`**: exports `useClientForm`/`ClientFieldsGrid` (nested §4.1 form — two addresses w/ "same as registered", primary contact, repeating existing-relationships, CIBIL) + `stateFromClient`/`stateFromLead`/`clientCompletionPct`/`CONSTITUTION_OPTS`; standalone create/edit modal (required minimum: name, constitution, primaryContact.mobile; admin can set ownerRm on create). **`Crm2ClientsPage`** rebuilt: list + search + **Add Client** (crm.cases.write) + profile-% bar column; row → detail. **`Crm2ClientDetailPage`** at **`/crm/pipeline/clients/:id`**: profile-completion header, §4.1 details card + **Edit** (owner/admin), **Assign RM** (manager/admin → PATCH ownerRm), **Blacklist/Reactivate** (manager/admin), **loan & product history** (cases `where('clientId','==',id') orderBy createdAt desc`), **Open New Case** (→ `POST /api/crm2/cases` → navigate), read-only **Document Vault** list. **Convert wizard** (`Crm2LeadsPage` ConvertModal): non-partner leads pick **Existing** (SearchableSelect of clients + resolve-by `FIN-CASE-…`/`FCL-…` via getDoc; auto-suggests a dupeKey match) or **New** (embedded `ClientFieldsGrid` prefilled from the lead) → product + handling RM → convert → **navigates to `/crm/pipeline/cases/${caseId}`**. PARTNER_DSA path unchanged.
- **Index**: new composite `cases (clientId ASC, createdAt DESC)` in `firestore.indexes.json` (loan-history query). **Deploy (maintainer)**: `deploy:rules` (unchanged — still verify bind) → `deploy:indexes` (wait new composite **READY**) → `gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling` (server change) → `npm run deploy` (hosting) → `verify:deploy`. **Pre-deploy: re-verify no live CRM 2.0 cases/slabs** (the `FCL-`/stage-order reshaping assumes none).

### Phase 3 ✅ DEPLOYED TO PRODUCTION (2026-06-16) — Customers→Leads move + Leads rework
Merged to main (`5db50ac`); staged deploy: `deploy:rules` (already-current) → `gcloud run deploy pulse-api --no-cpu-throttling` (**revision `pulse-api-00044-cm5`**, 100% traffic) → `npm run deploy` (hosting) → `verify:deploy` **3/3 green**; live smoke-check `POST /api/crm2/leads/:id/promote` + `POST /api/admin/run-crm2-followup-reminders` both **401** (registered, auth-gated). **Cloud Scheduler `crm2-followup-reminders` registered & ENABLED** (`*/15 * * * *`, asia-south1, OIDC SA `787616231546-compute@…`, audience = full URI; force-run smoke-tested OK). No rules/index change.

The funnel's middle. Old-CRM **Customers** (`/crm/leads`, old-model leads with NO `receivedAt`) and CRM 2.0 **Leads** (`/crm/pipeline/leads`, new-model leads WITH `receivedAt`) share the `/leads` collection; "promote" stamps the new-model fields onto the SAME doc. Decisions (Rahul): **auto-move on Interested · keep existing doc id (one record, no dup) · quick category/product dialog at promote · New-Customer form stays old-model cold**. tsc + build clean; gates **P1 12 · P2 31 · P3 13/14** (the 1 fail = vault-upload GCS-creds, environmental) **· P4 24 · P5 12**; 68/68 unit tests.
- **Backend** — **`POST /api/crm2/leads/:id/promote`** (`server/crm2.ts`, perm `crm.leads.write`): promotes an old Customer doc in place — maps `displayName→name`, `phone→mobile`, old `source`→new enum (`OLD_TO_NEW_SOURCE`), `triagePriority`→`HOT/WARM/COLD`, resolves `primaryOwnerId` uid→FAPL for `assignedRm` (or explicit), carries `callbackAt`→`nextFollowUpAt`, stamps `receivedAt`+`status:NEW`+`category`(req)+`promotedFromCustomer:true`+`leadStatus:interested`; **idempotent** (409 if `receivedAt` already set); old fields left intact (additive). `POST`/`PATCH /api/crm2/leads` extended with `linkedExistingClientId`, `customerProfile{constitution,businessName,annualTurnover,requirements}` (via `sanitizeCustomerProfile`), `referredByName`/`referredByCode`, `nextFollowUpNote`, and `followUpReminderSent` (re-armed to false whenever `nextFollowUpAt` changes). **`POST /api/admin/run-crm2-followup-reminders`** (`server.ts`, OIDC/admin, ~every 15 min): new-model leads with `nextFollowUpAt<=now` & `followUpReminderSent==false` & not converted → resolve `assignedRm` FAPL→uid+email → bell + branded email (carries the `nextFollowUpNote` remark) → set `followUpReminderSent:true`. **New Cloud Scheduler job to register post-deploy: `crm2-followup-reminders` (`*/15 * * * *`)**.
- **Frontend** — **Customers** (`LeadsPage` excludes any doc with `receivedAt`; `LeadDetailPage` intercepts the "Interested" disposition + a "Move to Leads" button → `PromoteToLeadDialog` (category req + optional product + optional RM override) → promote → navigates to `/crm/pipeline/leads`). **Leads rework** (`Crm2LeadsPage`): priority shown as a **Red/Yellow/Green** traffic-light dot (`PRIORITY_META`, enum values unchanged) + relabelled picker (`PRIORITY_OPTS`); **`ContactActions`** (Call/WhatsApp) + tappable `PhoneLink` on rows + the drawer header; **`NewLeadModal`** gains link-existing-client, a "+ More customer details" section (constitution/business name/turnover/requirements → `customerProfile`), and source-specific referral pickers (`REFERRAL_SUBDSA`→subDsa picker storing `referredBy*`+SDSA code; `REFERRAL_CLIENT`→client picker); the **drawer** adds a follow-up **remark** field (emailed), inline link-existing-client + referral editors, and shows referral/linked-client in the header. `buildReferral()` helper centralises the `referredBy*` payload.
- **Types** (`src/types/crm2.ts` `Crm2LeadFields`): added `referredByName`, `referredByCode`, `linkedExistingClientId`, `customerProfile`, `nextFollowUpNote`, `followUpReminderSent`, `promotedFromCustomer?`. Old `Lead` (`src/types/index.ts`) gained `receivedAt?` (the discriminator). **No rules/index change** this phase. **Deploy (maintainer)**: `deploy:rules` (unchanged, verify bind) → `gcloud run deploy pulse-api --no-cpu-throttling` (server: promote + lead-field + reminder job) → `npm run deploy` (hosting) → `verify:deploy` → register Cloud Scheduler `crm2-followup-reminders`.

### Phase 4 — per-login pipeline rebuild (HEAVIEST; in progress)
> **Phase 4a ✅ DEPLOYED TO PRODUCTION (2026-06-16)** — merged to main (`e804d7b`); `deploy:rules` (new logins block — ruleset `34ef943a`) → `gcloud run deploy pulse-api --no-cpu-throttling` (**revision `pulse-api-00045-wdd`**, 100%) → `npm run deploy` (hosting) → `verify:deploy` 3/3 green; login routes live (401 unauth). **The 3 test cases were deleted** (delete-&-recreate; backed up to console first — all OPENED/LOGIN, 0 money; `cases` now empty, clean slate). **Build #2 (per-login money engine + cutover) is the remaining, NOT-deployed work.**

The biggest change: the unit of sanction/disbursement/payout shifts from the **case** to the **login** (one file → one bank/NBFC). **Decisions (Rahul, 2026-06-16):** logins live in a **subcollection `cases/{id}/logins/{LGN-YYYY-####}`** · the case shows a **derived roll-up** (case-level stages 1–3, then In Progress/Completed from its logins) · the **3 live test cases are delete-&-recreate** (they're test data: 2 OPENED, 1 LOGIN, **0 payout cycles / MIS records** — so no money migration) · **structure first (Build #1 = pipeline), money second (Build #2 = per-login disburse→cycle+MIS)**. The deployed per-case engine + `disburse` are **left intact** during 4a (additive) — the legacy `CaseStage` machine still runs the existing Details/Documents/Payout tabs; the cutover of the case's own stage enum to `CaseLevelStage` + relocating payout to MIS + Client-ID tab is Build #2/cutover.
- **4a foundation ✅ (`6165370`)** — `src/types/crm2.ts`: `CaseLevelStage`+`CASE_LEVEL_STAGE_ORDER` (OPENED·BASIC_DOCS·DOCS·IN_PROGRESS·COMPLETED), `LoginStage`+`LOGIN_STAGE_ORDER` (FILE_LOGIN→CODE_LOGIN_DONE→IN_PROCESS→SANCTIONED→DISBURSED→PDD_OTC→COMPLETED), `Login` interface (bank/branch, SM/ASM, code+app-no, In-Process `subProcesses` PD/Technical/Valuation/Legal/Credit, sanction extras, BT/secured, PDD/OTC, reserved money fields, `applicantIds`, per-stage `keyDates`), `SubProcess`. `src/lib/crm2/logins.ts` (pure, **13 unit tests**): `validateLoginTransition` (forward-by-one, early-COMPLETED w/ REJECTED/WITHDRAWN, **DISBURSED reserved**), `keyDateForLoginStage`, `rollUpCaseStatus` (derived headline + counts), `caseCanComplete`, `validateCaseLevelTransition`.
- **4a backend ✅ (`599cc9a`)** — endpoints on `cases/{id}/logins` (server-only writes): **`POST …/logins`** (mint `LGN-YYYY-####` via `counters/logins-YYYY`, `seq`, stage FILE_LOGIN; connector/subDsa/amount default from the case; first login writes a LOGIN `stageHistory`), **`PATCH …/logins/:loginId`** (`LOGIN_EDITABLE` allowlist / `LOGIN_PROTECTED` rejected by name — decoupled data-entry; `subProcesses` merge + `queryLog` append/resolve), **`POST …/logins/:loginId/stage`** (`validateLoginTransition`; DISBURSED→422; early-close COMPLETED+outcome; stamps per-stage keyDates + stageHistory). `firestore.rules`: `cases/{id}/logins/{loginId}` read=`crm.cases.read`, write=false (**rules change — deploy needs `deploy:rules`**). Gate `.qa/crm2-phase4a-gate.mjs` **11/11**.
- **4a UI ✅** — `src/features/crm2/cases/LoginsSection.tsx` mounted as a **"logins" tab** on `CaseWorkspacePage`: derived roll-up header (`rollUpCaseStatus`), Add-Login, per-login cards (stage stepper, key fields, **Edit** form for all stage fields, **Advance →** forward-by-one, **Reject** early-close). Disbursement step shows "money engine (next build)" — reserved for Build #2.
- **QA**: tsc + build clean; all gates green (P1 12 · P2 31 · P3 13/14 env · P4 24 · P5 12 · **P4a 11**); **81 unit tests** (68 + 13). **Deploy when ready**: `deploy:rules` (new logins block) → `gcloud run deploy pulse-api --no-cpu-throttling` (login endpoints) → `npm run deploy` (hosting) → `verify:deploy`; then **delete the 3 test cases** and recreate on the new model.
- **Build #2 money engine ✅ DEPLOYED TO PRODUCTION (2026-06-16)** — merged to main (`b99c9fb`); `deploy:rules` (unchanged, verify bind) → `gcloud run deploy pulse-api --no-cpu-throttling` (**revision `pulse-api-00046-jtb`**, 100%) → `npm run deploy` (hosting) → `verify:deploy` 3/3 green; per-login disburse route live (401 unauth). Per-login disburse + cycle + MIS, additive (legacy per-case `disburse` left intact + still green P4 24/24). **MONEY-SAFETY GUARD: the legacy case-level `disburse` now refuses if the case has ANY logins** (`loginCount > 0` → 400) — a case is **EITHER legacy-per-case OR per-login, never both**, so the two engines can't double-disburse the same case. The case workspace **hides the case-level Record-Disbursement button + the Payout tab once logins exist** (steers to the Logins tab + MIS). This is the safe single-path guarantee; the remaining cosmetic cutover (case stage labels → `CaseLevelStage`, retiring the now-unreachable legacy stepper stages, Client-ID tab) carries no money risk. **`POST /api/crm2/cases/:id/logins/:loginId/disburse`** (perm `payout.write`): validates login SANCTIONED + login connector/lender + case-level DISBURSEMENT docs VERIFIED; `resolveSlab` on the login's connector×lender mapping (hard-fail 0/>1); FREEZES `mappingId/slabId/dsaCode` + disbursal onto the **login** (stage→DISBURSED, payoutStatus AWAITING_DATA_SHARE, payoutCycleId); mints **`PC-YYYY-####` from a dedicated `counters/payoutCycles-YYYY`** (multiple cycles per case now); creates `payoutCycles/{PC-…}` carrying **`caseId`+`loginId`** + `misRecords/{loginId}` (**id == loginId**, carries caseId+loginId); re-reads login in-tx to block double-disburse; money in the response gated on `payout.amounts.read`. **`GET …/logins/:loginId/disburse-preview`** (live slab preview). **Milestone endpoint made login-aware**: when the cycle carries `loginId`, it updates the **LOGIN** payout badge (`cases/{id}/logins/{loginId}.payoutStatus`) + `misRecords/{loginId}`; legacy per-case cycles (no `loginId`) still update the case + `misRecords/{caseId}` (`loginId ?? caseId` fallback). **No rules/index change** (payoutCycles/misRecords blocks already cover the new docs; recon/dashboards aggregate misRecords by content not id, so they work unchanged). **UI**: `LoginsSection` SANCTIONED logins show **Record Disbursement** (`payout.write`) → `DisburseLoginDialog` (amount/date/loan-a/c/city/state/roi/fee + live preview) → per-login disburse; **milestone management uses the existing MIS payout board** (GET `/api/crm2/payout-cycles` now includes per-login cycles). Gate **`.qa/crm2-phase4-money-gate.mjs` 8/8** (disburse→cycle+MIS keyed by loginId, frozen economics, milestone updates login badge+MIS in lock-step, no-mapping block, non-SANCTIONED block). tsc+build clean; all gates green (P1 12·P2 31·P3 13/14 env·**P4 24**·P5 12·P4a 11·**P4-money 8**); 81 unit tests.
- **Build #3 case cutover ✅ DEPLOYED TO PRODUCTION (2026-06-16)** — merged to main (`1c84d3f`); `deploy:rules` (unchanged, verify bind) → `gcloud run deploy pulse-api --no-cpu-throttling` (**revision `pulse-api-00047-rnq`**, 100%) → `npm run deploy` (hosting) → `verify:deploy` 3/3 green. The case stage machine is now **case-level only** + the recon engine is per-login-aware. The case is **EITHER per-case (legacy, login-less) OR per-login** (mutually exclusive via the Build #2 guard); new cases are always per-login.
  - **Case stage → `CaseLevelStage`** (`POST /api/crm2/cases/:id/stage` uses `validateCaseLevelTransition`: OPENED→BASIC_DOCS→DOCS→IN_PROGRESS→COMPLETED + early CLOSED; COMPLETED requires every login COMPLETED). Opening the **first login bumps the case to IN_PROGRESS**. The legacy per-case `disburse` endpoint stays (guarded + unreachable since a case can't reach case-level SANCTIONED) for safety, not removed.
  - **Recon per-login keying fixes** (misRecords id == loginId): recon-import `missingCaseIds` reads the misRecord's `caseId` FIELD (not doc id); **recon dispute** finds the cycle via `payoutCycles where caseId==` (+ optional `loginId`) and badges the **login** + `misRecords/{loginId}`; **snapshot job** reads the cycle via the misRecord's stored `payoutCycleId` (not a `FIN-CASE→PC` derived id) and groups per-login; **manual row-match** resolves the misRecord by id OR `caseId` field; **payout-reminders** read `misRecords/{loginId ?? caseId}`.
  - **Frontend**: `CaseWorkspacePage` stepper → `CASE_LEVEL_STAGE_ORDER`; **Payout tab + per-case DisburseDialog removed**, new **"Client-ID data" tab** (`ClientIdTab` — client master at a glance + "Open client master →"); the stage advance buttons are case-level ("Start logins" / "Mark case Completed"); history labels tolerant of legacy + login-stage values. `Crm2CasesPage` funnel/labels → case-level (`STAGE_LABEL` keeps legacy keys as fallbacks). `Crm2Case.stage` widened to `CaseLevelStage | CaseStage`.
  - **Gates reworked to per-login** (`setupSanctionedLogin` + per-login disburse; money read from the cycle, not the removed case mirror; cycle id from the disburse response): **phase3 12/13** (case-level walk; the 1 fail is the env-only GCS vault upload), **phase4 24/24** (per-login disburse→cycle+MIS keyed by loginId, frozen economics, out-of-order milestone ±override, business-sheet share + money-gating), **phase5 12/12** (recon by loginId, missing-case dispute → login DISPUTED, snapshot ties out per-connector). tsc + build clean; 81 unit tests; all gates green. **No rules/index change.** **Deploy**: `deploy:rules` (verify bind) → `gcloud run deploy pulse-api --no-cpu-throttling` → `npm run deploy` → `verify:deploy`.

### Sub DSA capture + terminology + milestone-UI fixes ✅ DEPLOYED TO PRODUCTION (2026-06-16, rev `pulse-api-00048-r9m`, merged `94472db`) — wiring gaps the user flagged
After an audit, four real gaps were fixed:
- **Sub DSA (FAC-) attribution was absent from CRM 2.0** (case/login only had `connectorId`→aggregators="Aggregator" and `subDsaId`→subDsas="Connector"; the HRMS `connectors`/FAC- "Sub DSA" channel partner the old CRM captured had **no field**). Added **`channelPartnerId`/`channelPartnerCode`/`channelPartnerName`** (FAC-) to **`Crm2LeadFields` + `Crm2Case` + `Login`**, picked from the HRMS `/connectors` (FAC-) registry. Carry-through: lead create/PATCH → convert (`case.channelPartner*` from the lead) → manual case open → **login inherits from the case** → **misRecord carries it for MIS reporting**. **Attribution only — no payout-math change** (the SDSA-/"Connector" per-login payout is unchanged; FAC- partner payouts stay manual via `connector_payouts`). UI: "Sourced by Sub DSA" picker on the CRM 2.0 New-Lead form + lead drawer (+ header display), and on the **case DetailsTab** "Sub DSA (Sourced By)" picker. Gate `crm2-phase4-money-gate.mjs` **11/11** (adds: login inherits channelPartner from case; misRecord carries it case→login→MIS). All editable allowlists (`CASE_EDITABLE_FIELDS`, `LOGIN_EDITABLE`) gained the fields.
- **"broker" stale source** → renamed to **`sub_dsa`** in the old-CRM `LeadSource` enum (legacy `broker` kept for old docs), `leadSchema`, `NewLeadPage` picker, and the SOURCE label maps (LeadsPage/LeadDetailPage/MyQueueRow/CrmDashboardPage gained `sub_dsa: 'Sub DSA'`).
- **CRM 2.0 referral relabel**: the `REFERRAL_SUBDSA` picker (which selects `subDsas`/SDSA-) was relabelled **"Referred by (Connector)"** (was "Connector / Sub-DSA") — subDsas = "Connector" per the rename; the actual Sub DSA is now the separate channel-partner picker.
- **`subDsaPayoutPct` override input** added to `DisburseLoginDialog` (the endpoint already accepted it; the UI never sent it).
- **Milestone UI for per-login cycles** (the orphaned gap): extracted **`CycleMilestones({cycleId})`** from `PayoutTab` (the 9-step timeline + forms, keyed by a cycle id); the **MIS Payout board** (`PayoutBoardPage`) row now opens a **milestone modal** (was bouncing to the case, which no longer has a Payout tab) with an "Open case →" link. `PayoutTab` is now a thin legacy wrapper.
- tsc + build clean; all gates green; 81 unit tests. **No rules/index change.** **Deploy**: `deploy:rules` (verify bind) → `gcloud run deploy pulse-api --no-cpu-throttling` → `npm run deploy` → `verify:deploy`.
- **Still deferred (communicated)**: login-level UI for **In-Process sub-processes** (PD/Technical/Valuation/Legal/Credit), **BT/secured** disbursement details, `docsSent`/`loginDone`/`directFromBank`/`insuranceAmount`/`otherCharges`/`rejectionReason`/`applicantIds`; the rich Stage-1 case form; and the **master expansions** (Aggregator multi-contacts, Product sub-product + default-docs editor, SM/ASM sub-list in Lender, mapping-by-product, Connector bank/TDS).

---

## Meta Lead Ads → CRM 2.0 webhook — Phase 1 (capture + queue) (2026-06-16) — BUILT, NOT deployed

Real-time Meta Lead Ads intake landing as **CRM 2.0 Leads** (`source: ADS`, `status: NEW`) in Pipeline → Leads. **Replaces the broken legacy `GET|POST /api/leads/intake/meta`** (which skipped real webhooks with `if (!val?.field_data) continue;` — Meta only ever sends a `leadgen_id`, never inline `field_data` — and whose verify token was unset, so 0 Meta leads ever flowed). Phase 1 = capture + queue ONLY; **routing (RM assignment) + contact-within-SLA timer are Phase 2; backfill of historical leads is a separate forward-only-webhook limitation**.

- **Endpoints** (`server/crm2.ts`, registered via `registerCrm2Routes`): **`GET /api/webhooks/meta/leadgen`** (subscription handshake — echoes `hub.challenge` when `hub.verify_token === META_VERIFY_TOKEN`, else 403); **`POST /api/webhooks/meta/leadgen`** (verifies `X-Hub-Signature-256` = HMAC-SHA256 over the **raw bytes** keyed with `META_APP_SECRET`, constant-time compare → **persist-first** to `meta_lead_events/{leadgen_id}` → **ACK 200 fast** → async pull+map+upsert; valid because Cloud Run runs `--no-cpu-throttling`); **`POST /api/crm2/jobs/run-meta-retry`** (scheduler-OIDC or admin — reprocesses pending / non-terminal-failed / stuck-fetching events).
- **Worker `processMetaLeadgen`**: Graph pull `GET /{META_GRAPH_VERSION}/{leadgen_id}?fields=field_data,…&access_token=…` → defensive field map (`mapMetaFields`: alias-tolerant name/phone/email/city, phone normalised via `normaliseMobile`) → **one transaction guarded on the event doc** mints `LD-${year}-#####` and writes the full `Crm2LeadFields` lead; soft person-dedup (`findDuplicate`/`buildDupeKeys`) **flags `duplicateOfLeadId`, never drops**. State machine `pending → fetching → done` (or `failed` + `lastError`; `terminal:true` after 5 attempts or for an unusable lead). Writes a `webhook_logs` row (`source: social_meta`).
- **Idempotency**: event doc id = `leadgen_id` (redelivered webhooks not re-queued) + the upsert tx re-reads the event and aborts if `status==='done'` → exactly one lead per `leadgen_id`. Lost-after-ACK events recovered by the retry job.
- **Product capture (Phase 2 dependency)**: `mapMetaFields` also reads the Instant Form's product question (aliases `product`/`loan_type`/`interested_in`/`which_loan`/…) → stored raw on `lead.sourceMeta.productInterest` + a deterministic keyword `inferCategory()` sets `lead.category` (LOAN/WEALTH/INSURANCE, else GENERAL — no AI). Phase 2 routing keys off this; its absence is a go-live blocker the inspect helper flags.
- **Pure helpers** in **`src/lib/crm2/meta.ts`** (`verifyMetaSignature`, `signMetaPayload`, `extractLeadgenEvents`, `mapMetaFields`, `inferCategory`) with **`meta.test.ts` (22 unit tests)**; crm2 unit total **103**. tsc + client build clean.
- **New collections**: `meta_lead_events` (write-ahead store) + `meta_lead_deadletters` (events that exhausted retries / are unusable) — both rules `read: isAdmin(); write: if false` (server-only via Admin SDK). Single-field `status` query (no composite index).
- **Dead-letter visibility**: on `terminal` the worker writes `meta_lead_deadletters/{leadgenId}` + sets `deadLetter:true` on the event + emits an **error-severity structured log** (`jsonPayload.event="meta_lead_deadletter"`, no token/PII) → a log-based Cloud Monitoring alert fires (command in GO-LIVE.md).
- **Mockable Graph base**: `META_GRAPH_BASE` env (default `https://graph.facebook.com`) lets the emulator gate redirect Graph calls to a local mock. **Never set `META_GRAPH_BASE` in prod.**
- **Verification helper (go-live)**: `GET /api/crm2/admin/meta-event/:leadgenId` (admin-only) prints the event state + landed lead's mapped fields and **asserts product interest is present** (fails loudly with a "form is missing the product question" message). CLI wrapper: `npm run qa:meta:inspect -- <leadgen_id>` (`META_ADMIN_TOKEN` env).
- **Emulator integration gate** `.qa/crm2-meta-gate.mjs` (run: `npm run qa:meta` → `.qa/run-meta-gate.sh` → `firebase emulators:exec` + dev server pointed at an in-process mock Graph API; offline/CI). **15/15 green**: idempotent redelivery → one lead · Graph-fail → no lead → retry recovers → one lead · terminal → dead-letter doc+flag+error-log, no lead · bad-sig 403 / malformed 200-0-queued. Wired into **`.github/workflows/ci.yml`** (lint → unit → qa:meta; setup-java for the emulator).
- **Env (Cloud Run, secrets — never commit)**: `META_VERIFY_TOKEN` (handshake), `META_APP_SECRET` (HMAC key — the security boundary), `META_PAGE_ACCESS_TOKEN` (**long-lived System User** token, `leads_retrieval` + `pages_manage_metadata`), `META_GRAPH_VERSION` (e.g. `v23.0`). Documented in `.env.example`; full runbook in **`docs/meta-webhook/GO-LIVE.md`** ([deploy]/[HUMAN]/[verify] steps + rollback + alert command); setup/manual-test in `docs/meta-webhook/README.md` (+ `sample-leadgen-webhook.json`).
- **Legacy cutover STAGED, not run** (`docs/meta-webhook/legacy-cutover.md`): removal of the broken `GET|POST /api/leads/intake/meta` lives on an unmerged branch `chore/remove-legacy-meta-intake`; merge only **after** a real test lead lands through the new endpoint (the legacy route returns 200 as a no-op fallback until then; `processInboundLead` stays — website intake uses it).
- **Deploy when maintainer ships**: `deploy:rules` (new `meta_lead_events` + `meta_lead_deadletters` blocks — verify bind) → `gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling` (sets the 4 `META_*` env vars) → `npm run deploy` (hosting unaffected) → `verify:deploy`. Then Meta-side wiring + Cloud Scheduler `crm2-meta-retry` (every 10 min → `/api/crm2/jobs/run-meta-retry`, OIDC) + the dead-letter alert policy — all in **GO-LIVE.md**. **Verification gate: one live test lead must flow capture → queue → (Phase 2) route → contact-within-SLA before ad budget goes live.**

---

## Two-stage lead SLA engine (2026-06-17) — BUILT, NOT deployed

Measures + alerts on lead responsiveness across **BOTH lead models** (old-model "Customers" `primaryOwnerId`/`createdAt`/`slaDeadline` + CRM 2.0 "Leads" `assignedRm`/`receivedAt`), every inbound source. **Notify-only — no auto-reassign.** Stage 1 = time-to-assign (capture → manager assigns); Stage 2 = time-to-first-contact (anchor → telecaller logs a first ATTEMPT). All clocks count **working time only**.

- **Pure libs** (unit-tested): **`src/lib/crm2/businessHours.ts`** — `elapsedWorkingMs`/`addWorkingMs`/`isWorkingDay` over a config (IST +5:30 fixed/no-DST, 10:00–18:30, Mon–Sat with **1st & 2nd Saturdays off**, Sun off; ordinal Sat = `floor((dom-1)/7)+1`); **15 tests**. **`src/lib/crm2/sla.ts`** — `classifySlaTier` (WARM=ADS/website · COLD=import-distributed · MANUAL=self-assigned), `slaAnchors` (model normalizer: `captureAt=receivedAt??createdAt`, assigned-signal incl. old `"UNASSIGNED"` sentinel, terminal detection both schemas), `evaluateSla` (per-stage working-elapsed vs window + `lateAssignment` attribution), `slaConfigFromDoc`/`SLA_DEFAULTS`; **18 tests**. (Supersedes the dead, calendar-only `slaUtils.computeSlaDeadline`.)
- **Tier windows (working-time, tunable via `app_config/sla`, defaults locked):** WARM stage1 15 min / stage2 30 min (from capture) · COLD stage1 48 h / stage2 24 h (from **assignment**) · MANUAL stage1 0 (assigned at t=0) / stage2 30 min. Business hours from `app_config/business_hours` (defaults if absent). Changing either doc changes behaviour with **no redeploy**.
- **`firstContactedAt` (new field, Stage-2 end)** — there was no first-contact timestamp before. Stamped **set-once** on the first attempt: server-side in `PATCH /api/crm2/leads/:id` (status→ATTEMPTED/CONTACTED · `incrementAttempts` · a logged activity); client-side set-once in `QuickLogBar` (`markFirstContact={!lead.firstContactedAt}`, wired in LeadDetailPage + MyQueueRow); the **sweep authoritatively backfills** old-model leads from their earliest `/activities` doc. Initialised `null` on every server create (CRM2 public/meta/internal/promote, old `processInboundLead` + `processImportBatch`) + the manual client `createLead`.
- **Sweep job `POST /api/crm2/jobs/run-lead-sla-sweep`** (`server/crm2.ts`, `requireSchedulerOrAdmin`, ~every 15 min): two disjoint candidate queries (`firstContactedAt==null` + `converted==false` [CRM2] / `+ deleted==false` [old]); per lead → old-model activity backfill → `evaluateSla` → on breach stamp **`slaStage1BreachedAt`/`slaStage2BreachedAt`** (server-only) + deliver in-app `notify()` + branded email; **Stage 1 → recipients resolved LIVE (never hardcoded): active `crmRole:'manager'` users, with super admins as fallback (env `SUPER_ADMIN_UIDS` ∪ active `superAdmin==true`) — via `resolveEscalationUids()`** (replaced the old `app_config/sla.escalationUids` / active-admins path 2026-06-17), Stage 2 → owner (`assignedRm` FAPL→uid via `faplToUid`, or old uid) + their `reportingManagerUid`, with late/timely attribution. Dedup = the per-lead breach stamp + a `crm2_reminder_logs/sla{1,2}_{leadId}` create-if-absent. Audit row to `webhook_logs` (`source:'sla_sweep'`). **Email seam** added to `registerCrm2Routes` Deps (`sendBrandedEmail`, implemented in server.ts wrapping `buildBrandEmail`+`sendGmailMessage`; **skips when `GOOGLE_SA_JSON_BASE64` unset** so dev/emulator never hits the GCE metadata server).
- **Indexes**: `leads(firstContactedAt,converted)` + `leads(firstContactedAt,deleted)` composites. **Rules**: `firstContactedAt` added to the old-model owner-update allowlist (client set-once); `slaStage1/2BreachedAt` deliberately **absent** → server-only (can't be cleared to dodge alerts).
- **Emulator gate** `.qa/crm2-sla-gate.mjs` (`npm run qa:sla` → `run-sla-gate.sh`): seeds a 24/7 business-hours config for deterministic timing; **17/17** — Stage-1 breach+alert+dedup, Stage-2 late-attribution, assigned-uncontacted → owner+manager+timely, cold-bulk no-breach-before-48h, set-once `firstContactedAt`, old-model activity backfill (no false breach), config-driven widening. Working-time/pause math proven by the **33 unit tests** (crm2 unit total **136**). Wired into `.github/workflows/ci.yml`. tsc + build clean.
- **NOT in scope (locked):** no schema convergence (bridge only); no auto-reassign/round-robin (no capacity model); Phase-1 Meta webhook + the staged legacy-removal branch untouched.
- **Deploy when maintainer ships**: `deploy:rules` (firstContactedAt allowlist — verify bind) → `deploy:indexes` (2 new composites READY) → `gcloud run deploy pulse-api --no-cpu-throttling` (sweep + email seam) → `npm run deploy` (hosting: QuickLogBar/useLeads) → `verify:deploy`. Then **register Cloud Scheduler `crm2-lead-sla-sweep`** (`*/15 * * * *` → `/api/crm2/jobs/run-lead-sla-sweep`, OIDC SA, like `crm2-meta-retry`); seed `app_config/{sla,business_hours,queues}` via `npm run seed:golive` (idempotent create-if-absent; defaults apply if absent — no `escalationUids` needed, escalation auto-resolves to active managers). _Optional follow-on (not built): surface `slaStage1/2BreachedAt` badges + an unassigned-age countdown in the manager queue view._

---

## FIFO pull-queue work model (2026-06-17) — BUILT, NOT deployed

Replaces manager-push as the **default** for warm-inbound CRM 2.0 leads (ADS + public website): they stay unassigned in shared, **oldest-first** queues; a free telecaller pulls the front of the line, which **claims** it (stamps owner + `assignedAt`) atomically at pickup. Manual `PATCH …/leads/:id {assignedRm}` remains the **manager override**. **Cold bulk imports stay on the Import-Queue `distribute` path** (untouched). Sits ON TOP of the SLA engine — `captureAt`/`assignedAt`/`firstContactedAt` unchanged; **Stage 1 now measures time-in-queue (claim latency)**, Stage 2 unchanged.

- **Pure lib `src/lib/crm2/queue.ts`** (14 tests): `QueueDef`, `DEFAULT_QUEUES` (`Loans`→`['LOAN']`/skill LOANS · `SIP`→`['WEALTH']`/skill SIP), `queueConfigFromDoc` (from `app_config/queues`, falls back to defaults), `leadQueueCategory` (explicit `category`, else `inferCategory(sourceMeta.productInterest)`, else GENERAL), `queueMatchesLead` (`['*']`=all), `eligibleQueues`/`leadEligibleForSkills` (**empty/unset `queueSkills` = eligible for ALL**; case-insensitive), `queueForLead`, `isQueueableLead` (ADS/WEBSITE + `receivedAt`).
- **Endpoints** (`server/crm2.ts`, perm `crm.leads.write`/`read`): **`POST /api/crm2/queue/claim`** — oldest unassigned warm CRM2 lead by `receivedAt` across the caller's eligible queues, claimed in a **Firestore transaction** (re-reads in-tx; loser falls through to the next → two concurrent claims never collide); stamps `assignedRm`=caller FAPL + `assignedAt` + `status` NEW→`ASSIGNED`; returns `{lead}` or `{lead:null}`. **`POST /api/crm2/queue/release`** `{leadId,reason}` — owner or manager/admin; `assignedRm`/`assignedAt`→null, `status`→`QUEUED`, **preserves `receivedAt`** (keeps its place), bumps `releaseCount`, sets `lastReleaseReason`, **`queueFlagged:true` + manager bell at `releaseCount>=3`**. **`GET /api/crm2/queue/state`** — per-queue `depth` + oldest-lead working-age (`elapsedWorkingMs`) + wall-age + Stage-1 SLA countdown (reuses the SLA lib) + active telecallers (claimed-but-uncontacted by `assignedRm`); for ~10s client polling.
- **Types**: `Crm2LeadStatus` gains `QUEUED`/`ASSIGNED`; `Crm2LeadFields` gains `firstContactedAt`/`releaseCount`/`lastReleaseReason`/`queueFlagged`; `UserProfile.queueSkills?: string[]`. `LEAD_STATUSES` extended server-side.
- **Index**: `leads(assignedRm, converted, receivedAt)` composite (claim/state FIFO query). **Rules**: queue fields are server-only — they're absent from the leads owner-update allowlist AND CRM 2.0 leads carry no `primaryOwnerId`, so non-admin clients can't update them at all (only `/api/crm2/queue/*` via Admin SDK); `queueSkills` lives on `/users` (admin-write only — not in the self-update allowlist). No rule logic change, only a clarifying comment.
- **Client** (`src/features/crm2/queue/`): `useQueue.ts` (`useQueueActions` claim/release · `useQueueState` 10s poller); `QueuePanel.tsx` mounted on `Crm2LeadsPage` — **"Get next lead"** (serve-don't-browse → claims + opens the lead) for any `crm.leads.write` user + a **manager monitor** (depth/oldest-age/SLA countdown/active reps); a `ReleaseControl` (reason) in the lead drawer when a lead is claimed.
- **Gate** `.qa/crm2-queue-gate.mjs` (`npm run qa:queue`) **18/18**: FIFO oldest-first, **atomic concurrent claims → different leads**, skill gating + empty-skills=all, claim stamps, release→QUEUED + captureAt preserved + flag-at-3, `/state` depth/age/SLA, **SLA regression** (unclaimed still Stage-1 breaches · `firstContactedAt` stamps post-claim Stage 2), live `app_config/queues` reshape (single `['*']` = one shared FIFO). Wired into `.github/workflows/ci.yml`. 150 crm2 unit tests; tsc + build clean.
- **Deploy when maintainer ships**: `deploy:rules` (comment only — verify bind) → `deploy:indexes` (new `leads(assignedRm,converted,receivedAt)` composite READY) → `gcloud run deploy pulse-api --no-cpu-throttling` (3 endpoints) → `npm run deploy` (hosting: QueuePanel) → `verify:deploy`. Optionally seed `app_config/queues` (else DEFAULT_QUEUES) + set `queueSkills` per telecaller (else all-eligible). _Flagged follow-on (not built): richer queue analytics / per-agent throughput dashboard._

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
match /claim-receipts/{employeeId}/{allPaths=**} {   // claim bills — added 2026-06-09
  allow read:  employee reads own OR admin/isHrmsManager (custom claims)
  allow write: employee writes OWN, contentType image/* or application/pdf, size < 10 MB
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

#### HRMS pages dark-mode — ✅ converted (2026-06-09)

**Was**: the June glass/theme sweep converted **CRM + MIS** feature pages to theme CSS vars but **skipped the ~40 HRMS feature pages**, which hardcoded light colours (`bg-white`, `text-ink`/`text-mute` → fixed `--color-*` in `index.css @theme`, `slate-*`, inline hex `#8B8B85`/`#FAFAF7`/`#0B1538`). The shells are theme-aware, so dark mode showed a **dark shell wrapping a light page**.

**Fix**: a two-pass codemod (run once, then deleted) converted **~1,935 colour spots across 43 HRMS files** to theme vars. **Mapping** (also use for any new HRMS page): `text-ink`/inline dark text (`#0A0A0A`/`#2A2A2A`/`#1A1A1A`)→`text-(--text-primary)`/`var(--text-primary)` · `text-mute`/`#8B8B85`/slate text (`#475569`/`#64748B`/`#94A3B8`/`#CBD5E1`)→`var(--text-muted)` · `bg-white`/`#FAFAF7`bg/`bg-slate-50/100`/`#F8FAFC`/`#F1F5F9`/`#FFFFFF`bg→`var(--glass-panel-bg)` · `border-slate-100/200`/`#E2E8F0`→`var(--shell-border)`. **Standalone navy `color:'#0B1538'`** (headings/values) → `var(--text-primary)`; **navy paired with gold `#C9A961`** on the same line (buttons/badges) → **kept** (navy-on-gold is correct). Gold/green/amber/red semantic accents and white-on-accent text kept. Theme vars resolve via `glass.css` (dark default → `body.light-mode`).

**Known minor stragglers** (acceptable; clean up if noticed): a few `bg-white/NN` translucent overlays (fine in dark), `hover:bg-slate-200` hovers, and gold-bordered (not gold-filled) chips with navy text. CRM/MIS pages may also have isolated hardcoded spots — convert with the same mapping if they surface.

**Separate class — dark-*built* modals** (opposite problem: hardcoded navy bg breaks in LIGHT mode). The codemod only handled light-built pages. A hand-rolled modal using `backgroundColor: 'rgba(11,21,56,0.9…)'` + white-alpha borders stays dark in light mode → invisible labels. **Fix: use the theme-aware classes `glass-modal-overlay` / `glass-modal-panel` / `glass-modal-header`** (as `EditMyDetailsModal` does) instead of hardcoded navy; white-alpha borders → `var(--shell-border)`, panels → `var(--glass-panel-bg)`; navy text on gold buttons → keep `#0B1538`. Fixed the New Claim modal (`ClaimsPage`) this way 2026-06-09 — it was the only HRMS modal not using the shared `Modal` component.

#### FULL-APP theme sweep — ✅ both themes, all modules (2026-06-10)

A second two-pass codemod (run once, then deleted) converted the **remaining ~790 hardcoded colour spots across 109 files** — this time covering BOTH failure classes app-wide (CRM + MIS + HRMS + shared components):

- **Dark-only → vars** (was invisible in light mode): `bg-white/5|10`→`bg-(--shell-hover-soft|hard)` · `hover:bg-white/5|10`→`hover:bg-(--shell-hover-soft|mid)` · `border-white/N`→`border-(--shell-border[-mid])` · inline `rgba(255,255,255,a)` borders/bg/text → `--shell-border[-mid]` / `--shell-hover-*` / `--glass-panel-bg` / `--text-dim|muted|primary` by alpha · cream `rgba(240,236,224,a)` text → text vars by alpha.
- **Light-only → vars** (was invisible in dark mode): `text-slate-300..600`→muted, `700+`→primary · `bg-slate-50/100`, `'#F1F5F9'`→`--shell-hover-soft|hard` · `border-slate-*`, `#E2E8F0`, `border-slate-50` row dividers, `divide-slate-*`→`--shell-border[-mid]` · inline dark-text hex (`#475569`/`#64748B`/`#8B8B85`/`#94A3B8`)→muted.

**Rules that must hold for every new page** (the codemod's exception list):
1. **Fixed pastel chip + matching fixed dark text** (`#FEE2E2`+`#991B1B`, `#D1FAE5`+`#065F46`, `#FEF3C7`+`#92400E`…) — KEEP; readable in both themes. **Never pair a fixed pastel bg with a `var(--text-*)`** — the var flips with the theme but the pastel doesn't (fix: tint bg `rgba(52,211,153,0.10)` + mid-tone fixed text like `#059669`, as in the compliance "filed" box).
2. **Fixed navy/gold surfaces keep FIXED text**: gold gradient buttons → `color:'#0B1538'`; navy hero strips (Attendance Today card) → `color:'#f0ece0'`/gold. A `var(--text-*)` on a fixed-colour surface breaks in one theme.
3. **`text-white` on solid accent buttons** (red/green/navy pills) — KEEP.
4. **Auth pages (`features/auth/`) are theme-EXEMPT** — fixed white card on fixed dark aurora; never convert them to vars (cream text on the white card in dark mode). The codemod excluded them.
5. Hand-rolled white modal panels (`bg-white rounded-2xl shadow-xl`) → `glass-modal-panel` class (done for Wealth/Insurance section modals + the attendance RegularizeModal).
6. Solid input fields needing an opaque bg → `bg-(--ss-bg)` (solid navy/white), not translucent panel bg.

**Mobile**: `ThemeProvider` now also syncs `<meta name="theme-color">` (`#050d1f` dark / `#FAFAF7` light) so the phone browser chrome matches the theme. The theme CSS itself is identical across breakpoints (mobile drawers/shells already use shell vars).

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
- **Lead disposition board (2026-06-08)**: `LeadsPage` (Customers) shows a **Kanban board above the table** grouping dispositioned leads by `leadStatus` (Interested · Callback later · No response · Not interested · Wrong number; click a card → lead). The table below shows only **remaining** (un-dispositioned / `new`) leads, so reps see what's left to work; header reads "N to action · M total". Live via the `useLeads` snapshot — a lead leaves the table for its board column the moment its status is set. Built for the call-back / no-response follow-up SOP.
- **Callback reminders (2026-06-08)**: every lead detail page has an always-visible **"📞 Schedule follow-up"** button (admin/owner) that opens a **datetime picker**; saving sets `leadStatus='callback'` + `callbackAt` and arms the reminder in one action (the Status dropdown's **"Callback later"** reveals the same picker). The board's Callback-later column shows each card's time, sorts soonest-first, and flags **due** cards in red. A 15-min Cloud Scheduler job (`callback-reminders` → `POST /api/admin/run-callback-reminders`) notifies the lead's owner (in-app bell + email) when the time arrives and sets `callbackReminderSent` (re-armed if the time is changed). Managers/admins see the same board. New lead fields: `callbackAt` (ISO), `callbackReminderSent`.

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

**Branding & encoding (2026-06-09)**: the shared template (`buildHrEmailHtml` in `src/lib/notifications.ts` for client-sent HR emails; `buildBrandEmail` in `server.ts` for scheduled-job emails) now leads with the **actual Finvastra logo** on a white header + gold rule — hosted at the stable URL **`https://pulse.finvastra.com/images/logo-finvastra.png`** (`public/images/logo-finvastra.png`, copied unhashed to `dist/`). **Subject headers are RFC 2047-encoded** in `sendGmailMessage`/`sendGmailWithAttachment` (`=?UTF-8?B?…?=` via `encodeEmailSubject`) — previously a raw `—` in the subject rendered as mojibake (`Ã¢Â€Â"`). **Subjects rewritten human/warm** (no "— Finvastra Pulse" suffix; brand is in the `From` name): e.g. "Your claim has been approved", "Update on your leave request", "Your IT declaration is accepted".

**`/api/hrms/notify/email` endpoint**: Updated to call `sendGmailMessage()`. Falls back to nodemailer SMTP only when a PDF attachment is present and `SMTP_USER`/`SMTP_APP_PASSWORD` are set.

**`/api/admin/test-smtp` endpoint** (admin **or scheduler OIDC**): POST sends a **branded** test email (new logo template via `buildBrandEmail`) to `rahulv@finvastra.com` (or body `{ to }`). Since it accepts scheduler OIDC, it can be fired without a browser admin token via a one-off Cloud Scheduler job → `run` → `delete`.

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
| HRMS sidebar **menu search** (2026-06-08) | `HrmsShell.tsx` — a "Search menu…" box sits below the logo (replaces the redundant "HR & Operations" label). Typing filters `SEARCH_INDEX` (every HRMS page; admin/SA items gated) and renders matches **grouped under their folder headers** (each item carries a `group`; rendered in `SEARCH_GROUP_ORDER`) so you can see which section a page lives in. Clears on navigation. **Organisation Chart** now also has a permanent home in the **Company** group (`navLink` + `sectionForPath`), not just search — it had no sidebar link before. |
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

### Import slowdown + stuck dock + skipped-row visibility (2026-06-12, later same day)

Three fixes after the Unity import: **(1) App-wide slowness** — `useImportHistory` subscribed to ALL `import_jobs` uncapped; failed jobs carry 1,000-row error arrays and the subscription mounts in CrmShell on every page → megabytes constantly re-streamed. Now `limit(25)`; server-side, per-chunk progress updates write **counts only** (errors array written once at completion). **(2) Stuck "processing" card** — a pre-perf-fix job died mid-run, stuck in `processing` forever (manually marked failed in Firestore). `ImportProgressDock` now: treats processing jobs started >30 min ago as **STALLED** (warning card + re-run guidance), every card incl. live progress is dismissible, dismissals persist in localStorage (`fv_dismissed_import_jobs`). **(3) Skipped-row visibility** — after a run, ImportPage shows a "Why N rows were skipped" breakdown (already-in-system / repeated-in-sheet / bad phone) + **Download skipped rows (CSV)** (`downloadErrorCsv`) for fix-and-retry; duplicates skip automatically on re-import. Files: `useImportJobs.ts`, `ImportProgressDock.tsx`, `ImportPage.tsx`, `server.ts`. Rev `pulse-api-00039-dn7`.

### Import performance fix (2026-06-12, same day)

Bulk import took tens of minutes for a 2,439-row sheet. Causes + fixes: **(1) per-row round-trips** — every row did its own duplicate-check query + its own commit (~5,000 serial round-trips). `processImportBatch` now works in **chunks of 30** (the Firestore `in` limit): one `in` duplicate query + one `WriteBatch` commit (≤90 ops) + one progress update per chunk; also detects **intra-sheet duplicates** via an in-memory hash set. **(2) Cloud Run CPU throttling** — the import runs after the HTTP response (fire-and-forget), where a default-throttled container gets a tiny CPU slice. `pulse-api` is now deployed with **`--no-cpu-throttling` (CPU always allocated)** — keep this flag on future `gcloud run deploy` commands or it reverts. Benefits all post-response background work (imports, notifications, calendar sync); slight cost increase covered by the ₹4k/mo budget alert. Rev `pulse-api-00038-4dn`.

### Import flexibility fix (2026-06-12)

A 2,439-row contact sheet (Name/Number/Disbursement-date only) failed **every** row with "Product '29-Jun-21' not recognised": ImportPage's `REQUIRED_FIELDS` forced a Product column mapping, so the date column was mapped to Product and the server hard-rejected each row. Fixes: **(1)** `REQUIRED_FIELDS = ['displayName','phone']` — Product is optional; product-less sheets import as raw leads with no opportunity. **(2)** `validateRow` no longer errors on unrecognised products — the lead imports and the raw value is preserved in the lead's `notes` (`Imported product value: X`). **(3)** The lead doc now stores the Notes column directly (`Lead.notes?` added to types) — previously notes only existed on the opportunity and were lost when no product was given. **(4)** Rows with REAL validation errors (bad phone, bad PAN) are **always skipped** — previously `skipErrors=true` imported them with the bad data; job `status` now derives purely from counts (`all errors → failed · some → partial · none → completed`). Files: `ImportPage.tsx`, `server.ts` (`validateRow`, `processImportBatch`), `types/index.ts`. Cloud Run redeployed (rev `pulse-api-00037-dxb`).

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
- `GET  /api/health` (static ok) · `GET /api/health/deep` (does a real Firestore read → 200 if OK, 503 if the DB read fails; **uptime-monitored** so DB/quota/rules outages page within minutes)
- `POST /api/dev/bootstrap-admin` — promote allowlisted admin email
- `POST /api/admin/users/:uid/sync-claims` — stamp role/access custom claims
- `POST /api/admin/sync-all-claims` — bulk re-stamp claims for EVERY user (admin-only; super-admin targets skipped unless caller is super admin). Button on Permission Manager. Run once so all tokens carry claims → the claims-first rules skip the per-request /users read. Returns `{synced, skipped, noAuth, total}`.
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
- `POST /api/leads/intake/website` · `GET|POST /api/leads/intake/meta` (LEGACY — broken, superseded) · `POST /api/leads/referral/submit`
- `GET|POST /api/webhooks/meta/leadgen` (Meta Lead Ads → CRM 2.0, Phase 1; in `server/crm2.ts`) · `POST /api/crm2/jobs/run-meta-retry` (scheduler retry) · `GET /api/crm2/admin/meta-event/:leadgenId` (admin go-live inspect)

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
- `POST /api/admin/run-callback-reminders` — fires owner reminders when a lead's scheduled `callbackAt` arrives (every 15 min)
- `GET  /api/crm/team/performance?period=` — caller's downline performance summary (Phase P)
- `POST /api/admin/run-weekly-team-digest` — Friday bell+email team review per manager (Phase P)
- `POST /api/crm2/jobs/run-lead-sla-sweep` — two-stage lead SLA (time-to-assign + time-to-first-contact), working-time, both lead models; notify-only (2026-06-17)
- `POST /api/crm2/queue/claim` · `POST /api/crm2/queue/release` · `GET /api/crm2/queue/state` — FIFO pull-queue work model (warm-inbound CRM 2.0 leads; atomic claim) (2026-06-17)
- `GET /api/crm2/admin/lead/:id` — admin go-live inspect: a lead's SLA + pull-queue timeline (capture/assigned/firstContact/breach stamps/queue). Helper: `npm run sla:inspect -- <leadId>`; `npm run queue:inspect` hits `/queue/state`. Consolidated runbook: `docs/go-live/PULSE-LEAD-PIPELINE.md`

**SPA fallback**: `GET *` → `index.html` (prod static).

---

## Complete Firestore Collection Index (firestore.rules — as of 2026-06-06)

Every collection with a rule block. The global deny-all (`/{document=**}`) rejects anything not listed here.

**Identity & profile**: `users`, `user_details`, `employee_profiles`, `employee_sensitive`, `users/{uid}/login_history`, `users/{uid}/known_devices`

**Notifications**: `notifications/{notifId}` (legacy), `notifications/{uid}/items/{itemId}`

**CRM — leads & deals**: `leads`, `leads/{id}/opportunities`, `…/activities`, `…/bank_submissions`, `…/investments`, `…/policies`

**CRM — config**: `opportunity_types`, `providers`, `document_types`, `commission_slabs`, `commission_records`, `commission_leakage_reports`

**CRM — ops & audit**: `import_logs`, `import_jobs`, `access_requests`, `webhook_logs`, `lead_view_logs` (Phase M), `meta_lead_events` + `meta_lead_deadletters` (Meta webhook write-ahead store + dead-letters — server-only write, admin read), `rtbf_log`, `public_tracker_links`, `crm_documents`

**HRMS — attendance & leave**: `attendance`, `attendance_regularizations`, `leave_applications`, `leave_balances`, `leave_balance_adjustments`, `leave_year_resets`, `leave_encashment_requests`, `comp_off_credits`, `holidays`

**HRMS — payroll & compliance**: `payslips`, `compliance_records`, `salary_history`, `it_declarations`, `generated_letters`

**HRMS — people ops**: `claims`, `company_documents`, `employee_documents`, `document_acknowledgements`, `announcements`, `assets`, `connectors` (+ `connectors/{id}/private/{doc}`), `connector_payouts`, `onboarding_checklists`, `offboarding_checklists`, `performance_reviews`, `probation_records`, `job_openings`, `candidates`, `training_programs`, `training_records`, `hr_tickets`, `profile_update_logs`

**MIS**: `commission_statements`, `commission_statements/{id}/lines`, `rm_payout_slabs`, `rm_payouts`

**Infra**: `rate_limits` (server-only), `audit_logs`, `access_logs`, `app_config` (Phase R — admin-set platform settings, e.g. `attendance_geofence`)

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
`followup-check` daily 09:00 IST (`30 3 * * *`) · `daily-rm-briefing` daily 08:30 IST (`0 3 * * *`) · `monthly-scorecards` 1st 07:00 IST (`30 1 1 * *`) — all in `asia-south1`, hitting `pulse-api` with OIDC (SA `787616231546-compute@developer.gserviceaccount.com`). Plus **`callback-reminders`** every 15 min (`*/15 * * * *`) → `run-callback-reminders`, and **`weekly-team-digest`** Fridays (`0 4 * * 5`, 09:30 IST) → `run-weekly-team-digest` (Phase P). Manage: `gcloud scheduler jobs run|pause|describe <name> --location=asia-south1`.

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

---

## Phase P — Director / Team Performance (2026-06-08)

Bridges the **HRMS reporting line into CRM scoping** so a manager/director sees and manages exactly their downline. **The "team" = the caller's transitive `reportingManagerUid` tree** (the same field the org chart uses). No new collections; deterministic aggregation of existing data.

**Route**: `/crm/team` — `src/features/crm/team/TeamPerformancePage.tsx`. Nav "My Team" in CrmShell, shown to `crmRole==='manager'` or platform admin.

### How it's scoped (strict team-only, no denormalised field)
- **Heavy reads run server-side** via Admin SDK — `GET /api/crm/team/performance?period=YYYY-MM` computes the caller's downline and returns **only their reports'** aggregates. Any signed-in user may call it; non-managers get an empty team (no leak — you only ever see your own reports).
- **Single-lead view/edit** is the only client-facing rule change: a CRM **manager can `get`/`update` a lead (and read its opportunities + activities) when he is the owner's reporting manager** — new `firestore.rules` helper `isManagerOf(ownerUid)` (`isManager()` + `get(users/owner).reportingManagerUid == caller`). Edit scope = same fields as the owner (status, callback, reassign-within-team, slaDeadline-clear). Opportunity deep-edit stays owner/admin. One cheap `get()` per single-doc op — no list-time fan-out (lists are server-driven).

### Server (`server.ts`)
- `computeDownline(users, managerUid)` — transitive descendant uid set.
- `computeTeamSummary(managerUid, period)` — bulk-queries leads / open opps / commission_records / rm_targets once, aggregates per member: leads, openOpps, pipeline ₹, disbursed ₹, target (`targets.disbursalAmount`), achievement %, overdue SLA, due callbacks; plus team `actionNeeded` lists (due callbacks + SLA breaches with leadIds).
- `GET /api/crm/team/performance` (signed-in; own downline).
- `POST /api/admin/run-weekly-team-digest` (OIDC/admin) — for every manager with an active downline, sends a **bell + email** digest (disbursed, pipeline, callbacks due, SLA breaches). Cloud Scheduler **`weekly-team-digest`** Fridays `0 4 * * 5` (09:30 IST) — registered & ENABLED.

### Page sections
Team KPI chips (disbursed/target · open pipeline · callbacks due · leads past SLA) · **"Action needed today"** (due callbacks + SLA breaches, each click-through to `/crm/leads/:id`) · per-member performance table (target vs achieved %, colour-coded 🟢≥80 🟡≥50 🔴).

### Access config
A director needs `crmRole: 'manager'` + `crmAccess: true` (and `isHrmsManager` for HR-gated bits). Set via Permission Manager. **M Hemadri Babu** (FAPL-012) set to `crmRole: manager` on 2026-06-08 (was `crmRole: admin`, which the rules never honoured — only top-level `role==='admin'` grants platform-admin; `crmRole` is read by `isManager()`/`isManagerOf()`).

### My Team — empty-state add-members (2026-06-12)
TeamPerformancePage's "No team assigned yet" state now offers **Add team members** for platform admins — `AddTeamMembersModal` (in the same file) sets selected active employees' `reportingManagerUid`/`reportingManagerName` to the caller via `writeBatch` (the same HRMS reporting-line field; client-side works because the `/users` admin-update rule applies). Admins also get a header "+ Add members" button. Non-admins (incl. `crmRole: manager`) cannot edit user docs per rules, so they see guidance to ask HR. `UserProfile` type gained `reportingManagerUid?`. _Same day: the page's 500 error was fixed — missing collection-group fieldOverrides on `pulse`; see the migration "CORRECTED 2026-06-12" note._

---

## Phase Q — Connectors (channel partners / DSAs) (2026-06-09)

External partners who **source loan / insurance / wealth cases**. NOT employees — **no Google Workspace login**. Managed in HRMS; their name **populates in CRM** when a case is added. All deterministic — no AI.

| Part | Where | Files |
|---|---|---|
| **Registry** (add/edit/soft-delete) | HRMS `/hrms/admin/connectors` (admin/HR) | `src/features/hrms/connectors/ConnectorsPage.tsx`, `src/features/hrms/hooks/useConnectors.ts` |
| **Customer (lead) picker** ("Sourced by Connector" on **New Customer**) | CRM `NewLeadPage` | `NewLeadPage.tsx`, `createLead` in `hooks/useLeads.ts` — stores `connectorId/Code/Name` on the **lead** |
| **CRM picker** ("Sourced by Connector" on add-case) | CRM `AddOpportunityPage` Step 3 | `AddOpportunityPage.tsx`, `createOpportunity` — stores on the **opportunity** (per-case override) |
| **Lead display** | `LeadDetailPage` header meta (`· Connector: Name (FAC-###)`) | `LeadDetailPage.tsx` |
| **Opportunity display** | CRM `OpportunityDetailPage` header meta | `OpportunityDetailPage.tsx` |
| **→ MIS flow** | `setPrimarySubmission` stamps `connectorId/Code/Name` on the **commission_record** (from `opportunity.connector ?? lead.connector`); shown in MIS Overview → **Disbursals** tab (Connector column) | `useBankSubmissions.ts`, `MisOverviewPage.tsx` |
| **Payouts** (what's owed per case) | Connector detail modal | `useConnectors.ts` (`useConnectorPayouts`, `addConnectorPayout`, `markConnectorPayoutPaid`) |
| **Nav + route** | HrmsShell People group + router | `HrmsShell.tsx`, `router.tsx` |

> **Connector now flows end-to-end (2026-06-10):** selected on the **New Customer** form (lead-level) → carried onto the **commission_record** when a bank submission is marked primary/disbursed (`setPrimarySubmission` reads `opportunity.connector` else falls back to `lead.connector`) → visible in **MIS → Disbursals** (Connector column), so each commission is traceable to its channel partner through to payout. `Lead` and `CommissionRecord` types gained `connectorId/connectorCode/connectorName`. The commission_records create rule has no `hasOnly`, so the extra fields write cleanly.

### CRM quick-add + per-case DSA code (2026-06-12)

| Part | Detail | Files |
|---|---|---|
| **Quick-add connector from CRM** | "+ New" button beside the Sourced-by-Connector picker on **NewLeadPage** and **AddOpportunityPage Step 3** opens `QuickAddConnectorModal` (name* / mobile* 10-digit / verticals* tick-pills / firm / email / own DSA code). Creates the **main `/connectors` record only** with the next FAC-### code (`quickAddConnector` in `useConnectors.ts`), notes "Added from CRM — HR to complete PAN/bank details before payout", and auto-selects it in the picker. PAN + bank (`/private/financial`) remain admin/HR-only. **Rules**: `/connectors` `allow create` now also `hasCrmAccess()`; `update` stays admin/HR. | `src/features/crm/components/QuickAddConnectorModal.tsx` (new), `useConnectors.ts`, `NewLeadPage.tsx`, `AddOpportunityPage.tsx`, `firestore.rules` |
| **DSA code per case** | When a connector is selected on Add Opportunity, a two-card choice "DSA Code for This Case": **Finvastra's DSA code** (default — bank pays Finvastra, we owe the connector a payout) or **Connector's own code** (bank pays them directly; shows their code if on record). Stored as `Opportunity.dsaCodeUsed: 'finvastra' \| 'connector_own'` (`DsaCodeUsed` type). `Connector.ownDsaCode?` added — editable in the HRMS ConnectorsPage form + shown in detail view + quick-add modal. | `types/index.ts`, `AddOpportunityPage.tsx`, `useOpportunities.ts` (`createOpportunity` connector param gained `dsaCodeUsed`), `ConnectorsPage.tsx` |
| **MIS linkage** | `setPrimarySubmission` stamps `dsaCodeUsed` onto the commission_record (from the opportunity). MIS Overview → Disbursals shows a **gold "Our DSA" / muted "Own DSA" badge** beside the connector name (tooltip explains payment direction) — finance can see at a glance which commissions arrive in Finvastra's statements and owe a connector payout vs which the bank pays the connector directly. | `useBankSubmissions.ts`, `MisOverviewPage.tsx` |

### Code scheme
`FAC-###` (FAC-001, auto-incremented from the max existing via `nextConnectorCode`). Editable in the form.

### Data model
```
/connectors/{id}                         ← main record (CRM-readable for the picker)
  connectorCode: 'FAC-001', displayName, mobile, email (NOT a Workspace login),
  address, firmName?, verticals: ('loan'|'wealth'|'insurance')[],
  status: 'active'|'inactive', notes?, deleted?, createdBy, createdAt, updatedAt

/connectors/{id}/private/financial       ← admin/HR ONLY (sensitive)
  pan (stored raw; UI masks via maskPan), bank { accountHolderName, accountNumber, ifsc, bankName, branch? }, updatedAt

/connector_payouts/{id}                   ← admin/HR ONLY — what Finvastra owes a connector
  connectorId, connectorCode, connectorName, businessLine, caseLabel,
  leadId?, opportunityId?, amount, status: 'pending'|'paid',
  notes?, createdBy, createdAt, paidAt?, paidBy?, paymentReference?
```
`Opportunity` gained `connectorId?` / `connectorCode?` / `connectorName?` (denormalised; written at create only — the owner-update rule's `hasOnly` doesn't include them, but create has no field restriction).

### Sensitivity split (least-privilege)
The **main `/connectors/{id}` doc is readable by CRM users** (so the add-case picker can list names) but **writable only by admin/HR**. **PAN + bank live in `/connectors/{id}/private/financial`, readable/writable by admin/HR only** — CRM users never see financial data. Soft-delete only (`deleted` flag; `allow delete: if false`) so payout history survives. PAN masked in the read view (reveal toggle); bank account shown in full to admin/HR (needed for payouts). PAN/IFSC format-validated; only name + mobile + ≥1 vertical are hard-required so partial onboarding isn't blocked.

### Firestore rules
`/connectors/{id}` read `isAdmin() || isHrmsManager() || hasCrmAccess()`, write admin/HR, no delete · `/connectors/{id}/private/{doc}` read+write admin/HR · `/connector_payouts/{id}` read+write admin/HR, no delete.

### Payouts flow
On a connector's detail modal: pending/paid summary chips, **Add payout** (business line + case reference + amount + notes), each pending payout has **Mark as paid** (reveals a payment-reference field). The connectors list shows each connector's **pending ₹** total (live from a `connector_payouts` subscription). Manual entry for v1 — not auto-created from disbursals.

---

## Phase R — Telecaller Field Ops + Geofenced Attendance + Manager Team View (2026-06-11)

Mobile-first features for telecallers and field RMs. All deterministic — no AI.

| Part | Feature | Files |
|---|---|---|
| **One-tap contact actions** | `ContactActions` + `PhoneLink` (`src/features/crm/components/ContactActions.tsx`) — Call (`tel:+91…` → default dialer), WhatsApp (`wa.me/91…`), Email (`mailto:`); `telHref`/`waHref` helpers normalise +91/spaces/dashes. Placed: QuickContactBar (new gold **📞 Call** button; Log Call renamed 📝; visibility widened from generator-only to **owner/manager/admin**), MyQueueRow (icon row + tappable number), LeadsPage table (tappable number), LeadDetailPage Phone cell (number + icon row) | `QuickContactBar.tsx`, `MyQueueRow.tsx`, `LeadsPage.tsx`, `LeadDetailPage.tsx` |
| **Geofenced clock in/out** | `src/lib/geo.ts` — `getCurrentPosition` (readable errors), `haversineMeters`, `useGeofenceConfig`/`saveGeofenceConfig` (`/app_config/attendance_geofence` `{enabled, lat, lng, radiusMeters, label}`), `enforceGeofence` (throws "You are X km from the office…" outside the radius; when disabled, still best-effort captures the point without blocking). `AttendancePage` runs the check before `checkIn`/`checkOut` and shows a radius hint; the GPS point is stored as `checkInLocation`/`checkOutLocation` on the attendance record (audit trail). **Admin config: AdminAttendancePage → new "Geofence" tab** — "Use my current location", radius (min 50 m), label, enable toggle | `geo.ts`, `src/features/hrms/hooks/useAttendance.ts`, `AttendancePage.tsx`, `AdminAttendancePage.tsx` |
| **Meeting-location on customer add** | NewLeadPage optional "📍 Use my current location" → `lead.meetingLocation {lat,lng,capturedAt}` (via `createLead` 4th param); LeadDetailPage shows "Met At → view on map" (Google Maps link) | `NewLeadPage.tsx`, `useLeads.ts`, `LeadDetailPage.tsx`, `types/index.ts` |
| **Lead reassign (share)** | LeadDetailPage header "Reassign" link (owner/manager/admin) → SearchableSelect of active CRM users → `updateWithHistory(primaryOwnerId)` + activity entry + bell notification to the new owner. Rules already allowed `primaryOwnerId` in the owner-update key set — this adds the UI | `LeadDetailPage.tsx` |
| **Manager team leads view** | `useTeamLeads(managerUid, enabled)` in `useLeads.ts` — resolves direct reports (`users.reportingManagerUid == me`, active only), then **one leads listener per report** (each query pins `primaryOwnerId` to a single value so the list rule can evaluate `isManagerOf`). LeadsPage: **"My customers / Team (N)" toggle** for `crmRole==='manager'` non-admins (built for Hemadri's telecaller team). Peers still cannot see each other's leads — only the manager fans out. LeadDetailPage work-controls (`canWorkLead`: disposition, callback, reassign, contact bar) now include managers — rules verify the real reporting relationship, a wrong manager's write fails | `useLeads.ts`, `LeadsPage.tsx`, `LeadDetailPage.tsx` |
| **Mobile pass** | MyQueueRow rewritten responsive: rows wrap, Product/Source/Stage hide on small screens, SLA always visible, action buttons become a full-width row on mobile (py-2 tap targets), contact icons ≥32 px; MyQueuePage header matches the new columns | `MyQueueRow.tsx`, `MyQueuePage.tsx` |

### firestore.rules changes (Phase R)
- **`isValidLead` hasOnly fix** — added `connectorId/connectorCode/connectorName` (**latent Phase Q bug**: creating a customer with a connector selected was rejected by rules for everyone, admin included) + `meetingLocation`.
- Leads `allow list` — added `isManagerOf(resource.data.primaryOwnerId)` (works because team queries pin `primaryOwnerId` per report; a broad unpinned query still fails).
- Attendance update `hasOnly` — added `checkOutLocation` (create has no hasOnly, so `checkInLocation` passes as-is).
- **New `/app_config/{docId}`** — read `isSignedIn()`, write `isAdmin() || isHrmsManager()`. Holds `attendance_geofence`; no PII lives here.
- Lead owner-update `hasOnly` — added `meetingLocation` (so "Log visit here" can refresh the last-met point).
- `isValidActivity` hasOnly — added optional `location` (GPS-tagged field-visit activities).

### Phase R second pass — Field RMs + mobile app UX (2026-06-11, same day)

| Part | Feature | Files |
|---|---|---|
| **Field-RM geofence exemption** | `GeofenceConfig.exemptUids: string[]` — picked via MultiSearchableSelect on the Admin Attendance → Geofence tab. Exempt employees (field RMs/telecallers) clock in/out from **anywhere**, but their GPS point is **required** (location denied = blocked) and stored on the record. AttendancePage shows "Field mode — you can clock in/out from anywhere; your location is recorded." `enforceGeofence(config, uid)` gained the uid param | `geo.ts`, `AttendancePage.tsx`, `AdminAttendancePage.tsx` |
| **Manager view of clock locations** | Admin Attendance Daily View — gold 📍 Google-Maps link next to check-in/out times whenever the record carries `checkInLocation`/`checkOutLocation` | `AdminAttendancePage.tsx` |
| **"Log visit here" on customers** | LeadDetailPage button (next to Schedule follow-up, owner/manager/admin) — captures GPS → writes a `meeting` activity with `location {lat,lng}` to `/leads/{id}/activities` AND refreshes `lead.meetingLocation` (header "Met At" link always shows the last visit). `LeadActivityFeed` renders a "📍 map" link on located activities — managers see the full visit trail per customer | `LeadDetailPage.tsx`, `LeadActivityFeed.tsx` |
| **Mobile bottom tab bar** | `src/components/ui/MobileTabBar.tsx` — app-style fixed bottom tabs (`md:hidden`, safe-area inset, glass bg) in **all 3 shells**: CRM = Dashboard/Customers/My Queue/Pipeline (referral-only users get Referrals/Submit), HRMS = Home/Attendance/Leave/Claims, MIS = Overview/Statements/Reconcile/Payouts, + a **Menu** tab opening the existing drawer. Hidden for share-only users (NOTHING LOCKED). Shells' main content gained `pb-24` below md so pages clear the bar | `MobileTabBar.tsx`, `CrmShell.tsx`, `HrmsShell.tsx`, `MisShell.tsx` |
| **Customers page mobile cards** | LeadsPage table is `hidden md:block`; below md a **card list** renders instead (name, tappable phone, source · RM · import, Call/WhatsApp/Email icons, Assign button on unassigned) — no horizontal scrolling, nothing cut off | `LeadsPage.tsx` |
| **Avatar upload + overflow guards + mark-only icon (2026-06-12, 2nd pass)** | (1) **Profile photo upload** — camera badge on the avatar (own profile) + the completion banner's "Upload profile photo" chip open a file picker; image is **compressed in-browser to a 256px JPEG (~15–30 KB)** via `compressImage({maxDim:256, quality:0.75})`, uploaded to the FIXED path `profile-photos/{uid}/avatar.jpg` (re-uploads replace — Storage never grows), URL saved to `users.photoURL` (already in the self-update rule keys). New `storage.rules` block: read = any signed-in (avatars render app-wide), write = own uid, image/*, <300 KB. (2) **Horizontal-overflow guards** — global CSS in glass.css (`body{overflow-wrap:break-word}` + `input,select,textarea{min-width:0;max-width:100%}`), `overflow-x-hidden` on all 3 shells' `<main>` (inner table/kanban scrollers unaffected), and `FieldRow` (profile detail rows) got `w-32 sm:w-44` labels + `min-w-0`/`overflow-wrap:anywhere` values — long emails were forcing page-level sideways scroll. (3) **PWA icon = the gold MARK only** (`public/favicon.png` at 78% on white) — the full lockup's wordmark was unreadable at icon size | `EmployeeProfilePage.tsx`, `storage.rules`, `glass.css`, 3 shells, `generate-pwa-icons.mjs` |
| **Mobile/UX polish pass (2026-06-12)** | From Rahul's phone-screenshot review: (1) **Login page = ONE logo** — removed the top-left wordmark + top-right watermark; the real `logo-finvastra.png` sits on a white chip inside the card (navy wordmark needs the white bg). (2) **Dropdown opacity** — NotificationBell / UserMenu / AppsMenu panels now use the opaque `var(--ss-bg)` surface (translucent glass let page text bleed through); the notifications panel is a fixed full-width sheet below the header on phones (was hanging off-screen). (3) **Employee profile header** — `flex-wrap` so action buttons drop below the name on phones (name was wrapping one-word-per-line); "Edit My Details" text gold (was navy = invisible in dark mode). (4) **Admin Claims** — mobile card list (`md:hidden`) with amount/status/Pay-checkbox; table `hidden md:table`. (5) **Pipeline board** — empty stages NO LONGER render as giant hollow columns (populated columns only + "N empty stages hidden" note); friendly empty-state panel when no deals; **mobile renders stages stacked vertically**; summary cards 2×2 on phones. (6) **ContactActions = real icons** — lucide Phone (gold) / inline **WhatsApp brand SVG** (green #25D366, the 💬 emoji looked like SMS and misled users) / lucide Mail. (7) **Attendance** — the "location is recorded" field-mode note is **super-admin-only** (employees see nothing; don't scare them); done-for-day tick is an **animated SVG draw-in check** (`fv-draw`/`fv-pop` keyframes in glass.css). (8) **CRM Dashboard RM Performance** — compact ranked list on phones (6-col table was cut off). (9) **PWA icon** — `scripts/generate-pwa-icons.mjs` composites via sharp; **current design (2026-06-12, 4th revision): the gold knot MARK only on the dark navy gradient** — `public/favicon.png` (transparent-bg source) at 62% on `#0B1538→#050d1f`, no wordmark (text unreadable at icon size; Rahul: "dark format with the logo only"). (Earlier revisions: real-logo-on-white → mark-only-on-white → full-lockup-on-navy → this.) | `LoginPage.tsx`, `NotificationBell.tsx`, `UserMenu.tsx`, `AppsMenu.tsx`, `EmployeeProfilePage.tsx`, `AdminClaimsPage.tsx`, `PipelinePage.tsx`, `ContactActions.tsx`, `AttendancePage.tsx`, `CrmDashboardPage.tsx`, `generate-pwa-icons.mjs`, `glass.css` |
| **Admin attendance calendar fix (2026-06-12)** | (1) **Active employees only** — Daily View, Monthly grid, and the month CSV export now filter `employeeStatus !== 'inactive'` at the page level (exited staff were shown in every view). (2) **Static date header** — the Monthly grid's date row is `sticky top-0` (it scrolled away before); day headers show the date + weekday initial; **today's column is gold-ringed**; Sundays red + theme tint. (3) **Theme fix** — sticky header/name/summary cells use the opaque `var(--ss-bg)` surface (the old fixed cream `#F2EFE7` was unreadable in dark mode and translucent panel bg let scrolled content bleed under sticky cells); the page tab bar bg is now `var(--shell-hover-hard)` for the same reason | `AdminAttendancePage.tsx` |
| **Live profile sync fix (2026-06-12)** | `AuthContext` was loading the user doc **once** with `getDoc` on sign-in and never re-reading it. Uploading a profile photo updated Firestore but all shells retained the stale profile object (no photo appeared in header, sidebar footer, or user menu). Fixed by adding an `onSnapshot` listener on `/users/{uid}` after the initial load — any change to the user doc (photoURL, role, permissions, any field) now propagates automatically to every shell and component that calls `useAuth()` without a page reload. Listener is cleaned up on sign-out and on unmount via `profileUnsubRef`. | `src/features/auth/AuthContext.tsx` |
| **Stale-recovery reload-loop fix (2026-06-12, same day)** | The first version of the stale-chunk auto-recovery (below) cleared its one-shot reload guard on ANY successful chunk load — when the shell chunk loaded from the SW cache but one page chunk kept failing, every cycle re-armed and reloaded again = **infinite reload loop** ("app not loading"). Fixed: the guard re-arms only after **15s of stable running** (`scheduleGuardRearm`); a persistent failure now lands on the error screen instead of looping. Error screen's "Refresh now" is a **true hard reset** (unregister SW + clear all CacheStorage, then reload) so a corrupted/stale SW state recovers in one tap. | `chunkReloadGuard.ts`, `router.tsx`, `RouteErrorBoundary.tsx` |
| **Stale-deploy auto-recovery + branded error screen + video logo everywhere (2026-06-12)** | (1) **Stale-chunk auto-recovery** — after every deploy, hashed chunk filenames change; a tab opened pre-deploy 404s on lazy navigation ("Failed to fetch dynamically imported module", seen on Manage Shares). `lazyPage` in `router.tsx` now catches the import failure and **hard-refreshes once** (sessionStorage guard `CHUNK_RELOAD_GUARD_KEY` in `src/lib/chunkReloadGuard.ts` prevents loops; cleared on any successful chunk load so each new deploy gets one silent recovery). (2) **`RouteErrorBoundary`** (`src/components/ui/RouteErrorBoundary.tsx`) attached as `errorElement` on **every top-level route** — replaces React Router's default "Unexpected Application Error!" with a branded screen (looping video logo + name): chunk errors show "A new version of Pulse is ready" and auto-refresh; otherwise Refresh now / **Go to home** (module-aware: `/crm→/crm/dashboard`, `/hrms→/hrms/dashboard`, `/mis→/mis/overview`) / **Sign out & sign in again** (hard navigation to `/login`). (3) **Video logo + Finvastra wordmark everywhere** — `VideoLogo showText` now on: launcher main + header (replaced the inverted PNG), LoginPage card (replaced the static PNG-on-white-chip), all 3 shell `FullPageLoader`s, launcher loaders + profile-load-failed screen, and the error boundary. | `router.tsx`, `RouteErrorBoundary.tsx` (new), `chunkReloadGuard.ts` (new), `LauncherPage.tsx`, `LoginPage.tsx`, 3 shells |

---

## Firestore DB Migration + Read-Reduction (2026-06-10) — INCIDENT FIX

**Incident:** the entire app appeared broken — launcher showed only HRMS, profile greeted "there", attendance stuck on "Loading…", in incognito too. **Root cause:** the original database `ai-studio-27afcadd-…` was an **AI-Studio-provisioned Firestore database with a hard 50,000 reads/day free-tier cap that CANNOT be lifted even with billing enabled** (billing *was* enabled / Blaze — confirmed). The daily read quota was exhausted, so every read returned **HTTP 429 RESOURCE_EXHAUSTED**. The client's `AuthContext` catches the failed `/users` read → `profile = null` → only-HRMS launcher + missing clock-in buttons (both key off the loaded profile). Diagnosed via an unauthenticated REST probe returning the 429 quota error.

### Fix 1 — Migrated to a new uncapped database `pulse`
A standard-edition database created with `gcloud firestore databases create` in the same (Blaze) project has **`freeTier: false`** — normal quotas, no cap. Steps performed:
1. `gcloud firestore export gs://<proj>-fs-backup/… --database=ai-studio-…` (full backup; managed export is **not** blocked by the read cap). Backup retained.
2. `gcloud firestore databases create --database=pulse --location=asia-southeast1 --type=firestore-native` (Standard; `freeTier:false`).
3. `gcloud firestore import <export-prefix> --database=pulse` (Enterprise→Standard import works — both `FIRESTORE_NATIVE`). Verified data via IAM REST read (users/connectors/leads/payslips all present).
4. Repointed: `firebase-applet-config.json` `firestoreDatabaseId` → `pulse`, `firebase.json` `firestore[].database` → `pulse`, `server.ts` `FIRESTORE_DB_ID` → `pulse`, and all `scripts/**` DB ids.
5. `firebase deploy --only firestore` (rules + indexes to `pulse`) → `npm run deploy` (client) → `gcloud run deploy pulse-api` (server).
6. `gcloud firestore databases update --database=pulse --delete-protection` (production safety).
- **The old DB `ai-studio-27afcadd-…` was DELETED 2026-06-10** once `pulse` was confirmed stable. The independent **managed export backup is retained** at `gs://gen-lang-client-0643641184-fs-backup/2026-06-10T06:59:32_16433/` — to recover that data, `gcloud firestore import` it into a (new) database. Only `pulse` remains in the project now.
- **Index cleanup:** the new DB strictly rejects **single-field indexes** ("not necessary, configure using single field index controls"). Removed 5 single-field entries from `firestore.indexes.json` (`leads/importHash`, `activities/at`, `commission_leakage_reports/runAt`, `commission_statements/importedAt`, `bank_submissions/slaBreached`) — Firestore auto-indexes single fields, so those queries still work. ~~Rule: the file must contain only composite indexes.~~ **CORRECTED 2026-06-12 (third missing-index incident):** that removal was WRONG for **collection-group** queries. Firestore auto-indexes single fields at COLLECTION scope only — a bare `collectionGroup(...).where(field,'==',…)` needs a **COLLECTION_GROUP-scope single-field index, declared as a `fieldOverrides` entry** (NOT a composite; an override replaces defaults so it must restate COLLECTION ASC/DESC/CONTAINS + add COLLECTION_GROUP ASC). On `pulse` these were missing → every bare CG equality query failed FAILED_PRECONDITION: **My Team 500'd**, Command Centre/CRM-dashboard open-pipeline + Targets actuals showed zeros, exit-flow reassignment check, bank-SLA/doc-expiry/commission-leakage scheduled jobs, scorecard activity counts all broken. Fixed: `fieldOverrides` for `opportunities.status`, `opportunities.ownerId`, `bank_submissions.status`, `bank_submissions.isPrimary`, `activities.by` + 3 CG composites (`opportunities(status,createdAt DESC)` pipeline list · `bank_submissions(status,isPrimary)` leakage job · `bank_submissions(status,interestRate)` rate memory) → 55 composites + 5 overrides. **Rule: `firestore.indexes.json` = composites AND `fieldOverrides`; any new bare collection-group equality query needs a fieldOverride for its field. Also: a composite starting with a field does NOT serve a bare single-equality CG query on it.**
- **⚠️ MISSING COMPOSITE INDEXES (fixed 2026-06-10, second pass):** the old DB had many composite indexes that had been **created ad-hoc via the Firebase Console and were NEVER captured in `firestore.indexes.json`**. The migration only rebuilt what was in the file, so ~24 composites were missing on `pulse` → those queries failed with "requires an index" and the hooks swallowed the error → **screens silently showed empty** (first reported as "attendance data vanished" — the data was fine; the query couldn't run). Fixed by auditing **every** `where(...)+orderBy(...)` query in `src/**` and adding all missing composites (attendance, claims, leave, documents, comp_off, hr_tickets, salary_history, training_records, access_requests, attendance_regularizations, leave_encashment, crm_documents, commission_slabs, rm_payouts, notifications, generated_letters, opportunities COLLECTION-scope, etc.) — now **52 composite indexes**. **Rule for the future: `firestore.indexes.json` is the single source of truth for composite indexes — never create one via the Console without adding it to the file, or it will be lost on any DB migration.**

### Fix 2 — Rules role checks now read custom claims first (cuts read volume)
The dominant read multiplier was `firestore.rules`: `isAdmin()`/`hasCrmAccess()`/`isHrmsManager()`/`isManager()`/`hasMisAccess()`/`isMisAdmin()`/`hasHrmsAccess()` each did a `get(/users/{uid})` — an **extra user-doc read on every gated request**. All now check `request.auth.token.<claim>` **first** (stamped by `POST /api/admin/users/:uid/sync-claims`) with the `get()` only as an `||` fallback, so a present claim short-circuits the read. **No lockout risk** (fallback authorises tokens lacking the claim); tradeoff is access changes propagate on next token refresh (≤1h). This resolves **pre-launch checklist item #3** ("Role checks read Firestore on every request"). To maximise the benefit, click **"Re-sync all claims"** on Permission Manager once (`POST /api/admin/sync-all-claims`) so every token carries claims (admins already do).

**Cost guardrail (2026-06-10):** a Cloud Billing budget **"Pulse — project spend" = ₹4,000/month** with email alerts at 50/90/100% is set on billing account `01A5A8-14BD6A-9CA811`, scoped to this project. Adjust the amount in the GCP console if real spend differs.

### Gotcha that cost an extra round (2026-06-10)
After repointing to `pulse`, the app **still** showed null-profile / only-HRMS. Cause: a brand-new Firestore database starts on **default deny-all rules**, and the combined `firebase deploy --only firestore` had **errored on the index-validation step before binding the rules**, so `pulse` never got a rules release — every signed-in read (incl. the `/users` profile read) was denied. An anonymous 403 probe can't distinguish "deny-all" from "real rules" (both reject anon). **Fix + rule for next time: after creating a new DB, deploy rules SEPARATELY (`firebase deploy --only firestore:rules`) and VERIFY the bound ruleset** via the Rules API: `GET https://firebaserules.googleapis.com/v1/projects/<proj>/releases` (needs header `X-Goog-User-Project: <proj>`) → confirm `cloud.firestore/<db>` points to a ruleset whose source contains your real rules (`isSignedIn`, `match /users`, …), not an empty/locked default.

### Prevention / follow-ups
- **Never use an AI-Studio free-tier database for production** — it ignores billing and hard-caps. Always a `gcloud`-created standard DB (`freeTier:false`).
- Further read cuts available if needed: add `limit()` to dashboard queries; convert broad collection-wide `onSnapshot` listeners (Command Centre, CRM dashboards, connectors) to one-time `getDocs` where live updates aren't essential.

---

## Reliability & Monitoring (2026-06-10)

Added after the DB-cap outage so future failures are **detected in minutes, fail gracefully, and aren't self-inflicted by a deploy.**

### Detection — Cloud Monitoring
- **Deep health endpoint** `GET /api/health/deep` (`server.ts`) — performs a real Firestore read; 200 only if it succeeds, else 503. A plain HTTP 200 check would NOT have caught the incident (index.html stayed 200 while reads 429'd) — this does.
- **Two uptime checks** (Cloud Monitoring, every 5 min, external probers): `Pulse API + DB (deep health)` → `/api/health/deep` (catches DB/quota/rules/API outages) and `Pulse app (pulse.finvastra.com)` → `/` (catches hosting/CDN outages).
- **Alert policy** `Pulse — app / API / DB down` (OR of both checks) → fires to **3 channels**: email `rahulv@finvastra.com`, email `kumar@finvastra.com`, and **SMS `+91 9247519002`** (verified). Manage in Cloud Monitoring → Alerting / Edit notification channels. (Cloud Monitoring has no voice-call channel — for call escalation, connect PagerDuty/Opsgenie.)
- **Budget**: ₹4,000/mo billing budget with 50/90/100% email alerts (see migration section).

### Graceful failure (client)
- `AuthContext` retries the profile read (`getDocWithRetry`, 3× backoff) and, if it still fails, sets `profileLoadFailed` instead of silently nulling the profile. `LauncherPage` then shows a clear **"We couldn't load your account — Reload / Sign out"** screen rather than a confusing modules-missing launcher.

### Data safety
- **Point-in-Time Recovery ENABLED** on `pulse` → 7-day rollback window for accidental data corruption.

### Safe deploys
- **`npm run verify:deploy`** (`scripts/verify-deploy.sh`) — post-deploy smoke test: app shell 200, deep health 200 (real DB read), and **rules actually bound to `pulse` with real content** (the exact thing that silently broke during migration). Exits non-zero on any failure. **Run it after every deploy.**
- New scripts **`npm run deploy:rules`** / **`deploy:indexes`** — deploy them SEPARATELY. A combined `firebase deploy --only firestore` aborts on an index error **before binding rules**, which is how `pulse` ended up on default deny-all. Deploy rules first, verify, then indexes.

---

## Phase P — A++ Build (2026-06-11) — ✅ MERGED TO MAIN + DEPLOYED TO PRODUCTION

Seven capability sets, all deterministic. QA'd via **`.qa/phase-p-usecases.sh`** — a rerunnable 27-assertion regression suite that signs real test users (a hardcoded-UID SA + a plain employee) into the emulators and exercises every new rules surface (share lifecycle/tamper-protection, presence own-doc writes, dispute access, activity validator + 5-min edit window, field_history attribution/immutability). Run anytime: `npm run dev:emulators` → `bash .qa/phase-p-usecases.sh`. Deployed 2026-06-11 (rules → indexes → hosting; post-deploy verified: new ruleset bound + enforcing on `pulse`, new routes 200, PWA manifest/sw/icons 200).

**Global UX rule (applies to all future work): NOTHING LOCKED.** Never render locked/greyed/disabled nav items or buttons for missing permissions — omit them entirely. Users only ever see what they can open.

### P1 — Page Sharing System
- **Registry** `src/config/shareablePages.ts` — `SHAREABLE_PAGES` (27 pages across crm/hrms/mis, REAL router routes), `PageKey`, `pageIcon()`, `resolvePageKey(pathname, search)` (trailing-slash tolerant; `/mis/overview?tab=disbursals` → `mis.disbursals`; MisOverviewPage now reads `?tab=`).
- **Schema** `/page_shares/{id}`: grantedTo/Name/Email, grantedBy/Name, pageKey/Title/Route, module, icon, active, grantedAt, revokedAt/By/ByName, note. **Permanent — no expiry concept.** Soft revoke + restore; never deleted.
- **Data-access trade-off (accepted)**: a share grants module-level DATA read — `/users/{uid}.sharedModules: ('crm'|'hrms'|'mis')[]` is maintained **in the same batch** as every share create/revoke/restore (removed only when no other active share remains in that module), and the rules helpers `hasCrmAccess()`/`hasMisAccess()`/`hasHrmsAccess()` accept it in their **get() fallback branch** (claims-first short-circuit unaffected). UI restricts navigation to the shared pages.
- **UI**: `SharePageButton` (+modal) in all 3 shell headers — rendered ONLY for super admins; share = batch(page_shares + sharedModules) + bell notification; revoke mirrors. `SharedNavSection` — share-only users see ONLY a gold "SHARED WITH ME" nav (full-access users with shares get it appended). **Route guards in each shell wait for `useMyShares().loading === false` before redirecting** (hard-refresh race); share-only users may open shared pages **+ their drill-downs** (`locationCoveredByShares` — e.g. a Leads share covers `/crm/leads/{id}`); anything else redirects to their first shared route. Launcher tiles show for share-holders.
- **Admin console** `/admin/shares` (`src/features/admin/ManageSharesPage.tsx`, SA-only, standalone no-shell): summary strip, employee/module/status filters, revoke/restore. Launcher "Manage Shares" link (SA-only).
- **Rules**: `/page_shares` read SA or grantedTo-self; create SA; update SA (revoke-fields only via hasOnly); delete false. NOTE: rules use the **hardcoded** `isSuperAdminUid()` — a UI-promoted SA cannot share until the printed manual rules edit is applied.

### P2 — Super Admin Promotion
- `isSuperAdmin(uid, profile?)` in hrmsConfig: hardcoded list OR `users.superAdmin === true` (client recognition without redeploy). SA-sensitive call sites pass `profile`.
- `SuperAdminPromotionSection` on Permission Manager (SA-only): Promote/Demote modal (employee select, gold warning, type-name-to-confirm; founding 3 are permanent; no self-demote) → sets doc flag → sync-claims → append-only `/super_admin_log` → emails ALL current SAs (existing Gmail transport) → **prints + copies** the `gcloud run services update pulse-api --update-env-vars SUPER_ADMIN_UIDS=…` command and the manual firestore.rules edit instruction. Log table at page bottom.
- Rules: `/super_admin_log` read+create `isSuperAdminUid()`, immutable. `/users` admin-update: only hardcoded SAs may touch the `superAdmin` key (anti-self-promotion).

### P3 — PWA + Offline
- `vite-plugin-pwa` (autoUpdate): manifest (Pulse, #0B1538/#050d1f, standalone, portrait-primary), icons 192+512 maskable (`public/icons/`, generated by `scripts/generate-pwa-icons.mjs` via sharp from the VastraLogo mark). **Asset precache ONLY — no workbox runtimeCaching for firestore.googleapis.com** (streaming channels; Firestore's own IndexedDB multi-tab persistence — already enabled in lib/firebase.ts — is the offline data layer). navigateFallback index.html, `/api/` denylisted.
- `OfflineIndicator` (amber dismissible banner, mounted in App.tsx). **PWA install (redesigned 2026-06-15)**: the old launcher-only `InstallPrompt` was replaced by a **global `InstallAppBanner`** (mounted in App.tsx, app-wide) backed by a singleton **`src/lib/pwaInstall.ts`** (captures `beforeinstallprompt` at module-eval; `canInstall()`/`hasNativePrompt()`/`promptInstall()`/`subscribeInstall()`/`isIOS()`/`isStandalone()`). The banner auto-appears ~3.5 s after the browser deems the PWA installable (hidden when already standalone or snoozed 5 days on dismiss); **iOS Safari** (no `beforeinstallprompt`) gets an Add-to-Home-Screen instructions sheet. A persistent **"Install app"** item also sits in the `UserMenu` (shown only when installable) → dispatches a `fv:install` window event the banner handles.

### P4 — Real-Time Presence (out-of-scope exception, approved)
- `/presence/{pageKey}/viewers/{uid}`: `{uid, displayName, avatarInitials, enteredAt, lastSeen, pageKey}`. Rules: read signed-in; write own doc only.
- `usePresence` (`src/features/crm/hooks/usePresence.ts`): write on mount, 30s lastSeen heartbeat, delete on unmount + beforeunload; **staleness (client-side 2-min lastSeen filter, re-evaluated every tick) is the real cleanup** — not query cutoffs. `PresenceChips` ("Also viewing:" ≤3 initials + "+N") on LeadDetailPage (`lead:{id}`) and OpportunityDetailPage (`opportunity:{id}`).

### P5 — Commission Dispute Workflow
- `/commission_disputes/{id}` (see `CommissionDispute` type): expected/received/variance/variancePct, status open|investigating|resolved|written_off, priority high(>₹10k)/medium(₹1k–10k)/low, assignedTo, append-only notes[], resolution. Rules: read/update admin||misAccess; create admin||misAdmin; delete false.
- **Auto-create** (`maybeCreateDispute` in `src/features/mis/hooks/useDisputes.ts`): fired from BOTH `autoMatch` and `manualMatch` in useReconciliation when a line lands as discrepancy with |variance| > 5% — deduped on open/investigating per commissionRecordId, fire-and-forget (never blocks reconciliation), bell + email to every MIS admin.
- `DisputesPage` at `/mis/disputes`: summary strip (Open/Investigating/Resolved/₹ at risk), filter chips, table, Assign-to-me / append-only notes / Resolve / Write-off, detail modal with CRM deep-links. MisShell nav "Disputes" + red open-count badge.

### P6 — One-Tap Activity Logging
- **NEW lead-level feed** `/leads/{leadId}/activities` (raw leads have no opportunity — the old MyQueue log failed on them). Rules block mirrors lead access; `isValidActivity` extended with optional `byName`/`opportunityId`; **5-minute own-content edit window** (`canEditOwnActivityContent`) on BOTH lead-level and opportunity-level activities.
- `QuickLogBar` (`src/features/crm/components/QuickLogBar.tsx`): call/whatsapp/email/meeting/note icons + input, min 5 chars, Enter submits, optimistic clear + "Logged ✓". Mounted at LeadDetailPage bottom; MyQueueRow's old outcome panel replaced with an expandable inline QuickLogBar + "Logged X min ago".
- `LeadActivityFeed` on LeadDetailPage: type filter chips, TODAY/YESTERDAY/EARLIER grouping, pencil-edit own items <5 min.

### P7 — Field History (audit diffs)
- Schema: `{parent}/field_history/{fieldName}/changes/{changeId}` — `{field, oldValue, newValue, changedBy, changedByName, changedAt, context}`. Written **in the SAME WriteBatch** as the parent update via `src/lib/fieldHistory.ts` (`appendFieldHistory`, `updateWithHistory`).
- Tracked: leads `leadStatus`/`tags` · opportunities `stage`/`status`/`ownerId` · commission_records `status`/`actualAmount` · bank_submissions `status` · users `crmRole`/`misAccess`/`designation`/`department` (Permission Manager + Employees edit modal).
- Rules: field_history blocks under all 5 parent paths — read admin||manager; create signed-in self-attributed; immutable.
- `FieldHistory` component (admin/manager): history icon → popover (last 5) + full-history modal. Placed: LeadDetail Status, OpportunityDetail Stage + Deal Size, CommissionRecords rows (Status/Amount), EmployeeProfile Department/Designation.
- AccessLogsPage: **CSV export** of the active tab's filtered rows (filters already existed).

### Phase P — new collections / routes / files index
**Collections**: `page_shares`, `super_admin_log`, `presence/{pageKey}/viewers`, `commission_disputes`, `{parent}/field_history/{field}/changes` (×5 paths), `leads/{id}/activities` (lead-level feed). `users` gained `sharedModules`, `superAdmin`.
**Routes**: `/admin/shares` (standalone SA console), `/mis/disputes`.
**Key new files**: `src/config/shareablePages.ts`, `src/features/auth/hooks/useMyShares.ts`, `src/components/ui/SharePageButton.tsx`, `src/components/layout/SharedNavSection.tsx`, `src/features/admin/ManageSharesPage.tsx`, `src/features/hrms/admin/SuperAdminPromotionSection.tsx`, `src/components/ui/OfflineIndicator.tsx`, `src/components/ui/InstallPrompt.tsx`, `scripts/generate-pwa-icons.mjs`, `src/features/crm/hooks/usePresence.ts`, `src/features/crm/components/PresenceChips.tsx`, `src/features/mis/hooks/useDisputes.ts`, `src/features/mis/disputes/DisputesPage.tsx`, `src/features/crm/components/QuickLogBar.tsx`, `src/features/crm/components/LeadActivityFeed.tsx`, `src/lib/fieldHistory.ts`, `src/features/crm/components/FieldHistory.tsx`.

### Phase P deploy — ✅ DONE 2026-06-11
Deployed in the safe order (`deploy:rules` → `deploy:indexes` → `npm run deploy`), then `verify:deploy` 3/3 green; production ruleset confirmed to contain all Phase P blocks and enforce them (anon probe 403). No new Cloud Scheduler jobs and no server.ts change in this phase (no Cloud Run deploy needed). Remaining human-eye checks: sharing UX with a real colleague, presence chips on two devices, PWA install on a phone, offline banner.
