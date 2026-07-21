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

## Refactor initiative (2026-07-21, in progress) — guardrails first
A staged, **behavior-preserving** structural refactor (plan `~/.claude/plans/melodic-roaming-sloth.md`), approved by Rahul, to lift the codebase from "works but leans on human discipline" to tooling-enforced. Phases: 0 guardrails ✅ · 1 shared money/date utils · 2 client `leadModel` adoption + kill the `deleted==false` trap · 3 split the backend god files (`server.ts` 6k/70 routes, `server/crm2.ts` 5.7k/75) into `server/routes/*` via the existing `registerXxx(app, ctx)` pattern · 4 break up the 1000+ line pages (MastersPage 1805, OppDetail, Offboarding, CaseWorkspace, EmployeeProfile) · 5 (opt) strict TS incrementally. Rule: every phase is its own verified, shippable commit; NO feature/behavior change; verify tsc+eslint+`npm test`+build+gates each step.

### Phase 0 ✅ (2026-07-21, tooling-only — NOT a runtime change, no deploy) — ESLint + CI guardrails
- **NEW `eslint.config.js`** (flat, ESLint 9 + `typescript-eslint` 8 + `eslint-plugin-react-hooks` 7): deliberately LENIENT. The headline is **`react-hooks/rules-of-hooks` = `error`** — auto-catches the "hook after an early return" crash class (React #310) that CLAUDE.md previously guarded with a manual `awk` scan. `no-explicit-any`/`exhaustive-deps`/style rules OFF for now; `@typescript-eslint/no-unused-vars` = warn; stale `eslint-disable exhaustive-deps` directives silenced.
- **Hook-debt baseline:** ESLint found **123 real rules-of-hooks violations in 15 files** (the "guard clause before the hooks" pattern — worst `HrLetterGeneratorPage` 62; masked in practice by upstream route-gating, which is why they've never crashed). These 15 files are **baselined to `warn`** (listed in `HOOK_BASELINE` in the config) so CI is green + all OTHER code is protected by `error`; each will be fixed when its page is restructured in Phase 4 (remove from the list then).
- **Deferred as unsafe/churn** (documented, NOT done): tsconfig `noUnusedLocals`/`noUnusedParameters` — would HARD-FAIL the build on the ~31 unused locals deliberately kept (possible side-effecting initializers); ESLint warns on them non-blocking instead. Prettier — skipped to avoid a whole-repo reformat diff.
- **`package.json`**: added devDeps (eslint toolchain) + **`"lint:es": "eslint ."`**. **CI** (`.github/workflows/ci.yml`): added ESLint + `npm run build` + the `qa:partner` gate (was defined but unwired) → Typecheck → ESLint → Unit tests → Build → 4 emulator gates. Verified locally: tsc 0 · `eslint .` exit 0 · **202 unit tests pass** · build clean.

### Phase 1 (started) ✅ (2026-07-21, hosting-only, verify:deploy 3/3) — shared money util
`src/lib/money.ts` (pure, **6 unit tests**) is the ONE home for ₹ formatting, replacing 20+ private copies that had drifted into three behaviours: **`inr(n)`** (exact, null→'—' — the crm2 variant), **`inrRound(n)`** (whole-rupee, null/NaN→₹0), **`inrPaise(n)`** (2-decimal payslip/FnF). Each reproduces an existing behaviour EXACTLY. Adopted this increment in the **6 byte-identical crm2 `inr` files** (CaseWorkspace, PayoutTab, DashboardsPage, MisGrid, PayoutBoard, Recon) — zero display change. **Next increments:** swap the rounded `fmtINR`/`inr` copies → `inrRound` and the payslip `formatCurrency` → `inrPaise` (each verified per-site for parity), then add `src/lib/dates.ts` (`formatIst`/`istDateKey`) for the ~12 hand-rolled IST formatters. **Rule: match the EXACT existing behaviour when swapping — never change a displayed number.**

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
- `firebase-blueprint.json` — entity-schema reference (docs only, not loaded at runtime). Covers Phase 1–4 (user/attendance/leave/payslip/commission) **+ the full CRM 2.0 `cases` block** (added 2026-06-17): `case` + sub-collections `case_applicant` / `case_doc_tracker` / `case_stage_history` / `case_login` / `case_task` / `case_payout_mirror`, with their `/cases/**` paths. The authoritative source of truth remains `src/types/crm2.ts` + `firestore.rules`; keep this file in sync when the case schema changes.
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
    │   ├── AuthContext.tsx           session, 12-hour idle timeout (SESSION_TIMEOUT_MS), mustResetPassword
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
| Idle session timeout | ✅ Added | `AuthContext.tsx` `SESSION_TIMEOUT_MS`; event listeners on click/keydown/scroll/mousemove/touchstart; `sessionStorage` flag shows "Session expired" on login page. **Bumped 30 min → 1 hour (2026-06-26) → 12 hours (2026-06-29)** — users kept getting logged out after being away from the tab; 12 h covers a full working day. Timer resets on any interaction, so it only fires after a full 12 h of ZERO activity. **Purely client-side (a browser `setTimeout` + local `signOut`) — no backend call, no cost.** The only OTHER sign-out paths are the @finvastra.com domain gate and `revokeRefreshTokens` in the *deactivate* (mark-as-exited) flow — neither affects an active user. Firebase ID tokens still rotate hourly via the refresh token (auto, free); that is NOT a logout. |
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
- ~~**Still deferred (communicated)**: login-level UI for In-Process sub-processes, BT/secured, login flags; the rich Stage-1 case form; and the master expansions.~~ **→ ALL BUILT 2026-06-17 (NOT deployed) — see "CRM 2.0 deferred-UI completion" below.**

### CRM 2.0 deferred-UI completion (2026-06-17) — ✅ DEPLOYED TO PRODUCTION (2026-06-17)
The remaining CRM 2.0 deferred list (all of which had ready backends — only UI/forms or additive fields were missing). tsc + build clean; gates **phase3 12/13** (the 1 fail is the env-only GCS vault upload — no ADC in the sandbox), **phase4 24/24**, **phase4-money 11/11**; an 8/8 masters smoke proves every new master field round-trips (incl. subDsa bank encrypted to last-4, raw acct never stored). Commits `a233e19` (login form), `bb9dbd4` (Stage-1), `c2f50b0` (masters). **Staged deploy:** `gcloud run deploy pulse-api --source . --no-cpu-throttling` (server: stage1 sanitizer, master sanitizers, login SM/ASM auto-accumulate) → **revision `pulse-api-00051-sc4`** (100% traffic) → `npm run deploy` (hosting) → `npm run verify:deploy` **3/3 green** (app 200, API+DB deep-health 200, rules still bound to `pulse` ruleset `6450072d` — no rules/index change this build).

- **Per-login edit form** (`LoginsSection.tsx` `EditLoginModal`, commit `a233e19`) — was a flat 17-field grid; now a **stage-sectioned form** covering every field the login PATCH `LOGIN_EDITABLE` allowlist already accepted but the UI never exposed: File-Login (`amountRequested`, `docsSent`/`directFromBank` toggles), Code+Login (`loginDone`), **In Process** (the 5 parallel `subProcesses` — PD/Technical/Valuation/Legal/Credit, each status+query+remarks, merged server-side — plus a **query log** raise/resolve that fires its own PATCH, decoupled from the main save), Sanctioned (`insuranceAmount`/`otherCharges`/`sanctionDate`/`verifiedAppNo`), Disbursement extras (**BT** amount/date/mode/topup-final + **Secured** MODT/agreement/mode conditional panels — structure now, payout-routing later per decision I), PDD/OTC (`pddPendingList`), and an **`applicantIds`** checkbox picker from `cases/{id}/applicants`. The login card shows an at-a-glance sub-process / BT / Secured summary once a login reaches In Process. **Pure UI — no server/rules/index change.**
- **Rich Stage-1 (Opened) underwriting form** (`CaseWorkspacePage.tsx` Details tab `Stage1Panel`/`Stage1Modal`, commit `bb9dbd4`) — captures PLAN §4 stage-1 data: property (description/address/market value), last-3-FY turnover, GST turnover, income (company/individual/rental), an existing-loans table, two references, and a partner/director notes field. New optional **`Crm2Case.stage1`** (`CaseStage1` interface, additive). Server: `"stage1"` added to `CASE_EDITABLE_FIELDS`; **`sanitizeStage1()`** shapes the object (bounded arrays, typed scalars, never trusts client field count); case-open (manual + convert) defaults `stage1: null`. `CASE_PROTECTED_FIELDS` + all existing handlers untouched. Editable anytime (decision F) — saving does not advance the stage. **No rules/index change.**
- **Master expansions** (`MastersPage.tsx` + `server/crm2.ts` sanitizers + `types/crm2.ts`) —
  - **Generic form gained `kind:'rows'`** (repeating object-rows editor) **and `kind:'taglist'`** (comma-separated→string[]), plus optional `expand`/`transform` hooks on `MasterTab` (flatten nested→form keys for edit, reassemble before submit).
  - **Aggregator** — new `contacts: [{name,dept,mobile}]` + `emails: [{name,dept,email}]` arrays (multiple phone/email contacts; empty rows filtered server-side). `sanitizeAggregator` adds both (cap 50, filtered).
  - **Product** — new `subProducts: string[]` (taglist) + the **default-docs editor** (`defaultDocChecklist` multiselect of documentMaster, which existed on the type but was never in the form). `sanitizeProduct` adds `subProducts`.
  - **Lender SM/ASM sub-list** — the `contacts` rows editor (name/role[SM/ASM/RM/Other]/mobile/email/branch) is now in the Lender form (manual add) AND the **login PATCH auto-accumulates** SM/ASM into the lender's `contacts` (deduped by name+role, best-effort, non-fatal — decision G).
  - **Connector (subDsas)** — bank (`payoutBank` via flat `bankName`/`bankAccountNo`/`bankIfsc` fields reassembled by `transform`; account encrypted, last-4 shown, blank-keeps-existing) + new **`tdsPct: number|null`**. `sanitizeSubDsa` adds `tdsPct`.
  - **Mapping-by-product was ALREADY built** — `MappingsTab` `AddSlabModal` picks `productIds` per slab; noted, not rebuilt.
  - New type fields: `Aggregator.contacts`/`.emails`, `Product.subProducts`, `SubDsa.tdsPct`. All additive — existing docs read with `?.`/`?? []`. **No rules/index change.**
- ~~**Sub-DSA (FAC-) payout decision still open**~~ → **RESOLVED 2026-06-17: Rahul chose AUTO per-login payout. Built + deployed — see "Sub DSA (FAC-) auto-payout" below.**

### Sub DSA (FAC-) auto-payout (2026-06-17) — ✅ DEPLOYED TO PRODUCTION (2026-06-17)
Rahul's decision (auto, not attribution-only): each FAC- "Sub DSA" sourcing partner gets a payout **defined per product** (manual definition per DSA × product), **auto-calculated at disbursement**, with a **manual override per case** (because payout varies between companies). Basis is the partner's choice per rule: **flat ₹ · % of disbursed · % of Finvastra's payout**. tsc + build clean; gates **phase3 12/13** (env-only GCS fail), **phase4 24/24**, **phase4-money 13/13** (+2: auto-payout ₹2,000 = 0.2% of 10L created/auto/pending; override ₹9,999 honored auto=false); **162 unit tests** (+12 for the new lib). Cloud Run **revision `pulse-api-00052-zfp`** (100% traffic) + hosting; `verify:deploy` 3/3 green (rules unchanged — ruleset `6450072d`).
- **Pure lib `src/lib/crm2/channelPartnerPayout.ts`** (+12 tests) — `ChannelPartnerPayoutRule {productId|'ALL', basis: 'DISBURSED_PCT'|'FINVASTRA_PCT'|'FLAT', value}`; `resolveChannelPartnerRule` (exact product → 'ALL' fallback), `computeChannelPartnerPayout` (basis math, round-2, null-safe), `sanitizeChannelPartnerRule` (clamps % to 100). Imported by both server (`../src/lib/crm2/channelPartnerPayout.js`) and client.
- **Types** (`types/index.ts`, additive): `Connector.payoutRules?`; `ConnectorPayout` gains `caseId?`/`loginId?`/`payoutCycleId?`/`basis?`/`rate?`/`auto?` (CRM 2.0 linkage; `auto:false` = overridden).
- **Server** (`server/crm2.ts` per-login `disburse`): reads the FAC- `/connectors/{id}` doc, resolves the rule for the case's product, computes the amount; `channelPartnerPayoutOverride` in the body wins. When > 0, **creates a `connector_payouts` doc INSIDE the disburse transaction** (status `pending`, linked to caseId/loginId/payoutCycleId) — paid later via the existing HRMS connector-payout flow. **No payout-cycle / MIS / margin math changed** — this is a *separate* downstream liability, NOT folded into the SDSA-/Connector per-login payout. The disburse-preview endpoint returns `{channelPartner:{name,rule,payout}}` for the live dialog. Money fields (incl. the cp amount) stay gated by `payout.amounts.read`. **connector_payouts is written via Admin SDK (rules bypassed) — no rules change.**
- **UI**: HRMS `ConnectorsPage` connector form gains a **per-product payout-rules editor** (product picker incl. "All products" · basis · value); `useConnectors` `ConnectorInput`/create/update persist `payoutRules`. The CRM **`DisburseLoginDialog`** shows the sourcing Sub DSA + its auto-computed payout + an **override input** (blank = use the rule). The old "Sub-DSA payout %" field (the SDSA-/Connector slab override) was relabelled **"Connector payout % override"** to disambiguate from the new FAC- field.
- **Still manual (by design)**: marking the FAC- payout PAID stays in HRMS `/hrms/admin/connectors` (the existing pending→paid flow); only the *creation + amount* is now automatic.

### Phase 6 — Case collaboration (Tasks depth + multi-RM sharing) (2026-06-17) — ✅ DEPLOYED TO PRODUCTION (2026-06-17)
**The final phase of the CRM 2.0 Business-Requirements Update (plan `~/.claude/plans/eager-noodling-floyd.md`) — Phases 1–6 all DEPLOYED.** Multi-RM case sharing + a per-case task/update comms thread that feeds the Tasks page (PLAN §5). Case access was already permission-wide (`crm.cases.read`), so collaboration is **attribution + a worklist + comms**, not access-gating. tsc + build clean; gates **phase6 10/10**, regression green (phase3 12/13 env, phase4-money 13/13, **162 unit tests**). **Rules + index changed** → full staged deploy.
- **Types** (`types/crm2.ts`, additive): `Crm2Case.collaborators?: string[]` (FAPL-xxx, besides handlingRm); new `Crm2CaseTask` (kind `task`|`update`, text, assignedTo/Name, status `open`|`done`, doneAt/By, denormalised `caseId`+`clientName` for the cross-case query).
- **Server** (`server/crm2.ts`) — **`POST /api/crm2/cases/:id/collaborators {collaborators}`** (full-set replace; guard admin || manager || handlingRm; FAPL-regex validated, deduped, handlingRm stripped, cap 12; bells newly-added). **`POST /api/crm2/cases/:id/tasks {kind,text,assignedTo?}`** (creates a thread entry — updates are `status:done` informational, tasks are `open`+assignable; bells the counterparties = handlingRm ∪ collaborators ∪ assignee, minus author). **`PATCH …/tasks/:taskId {status}`** (toggle done; tasks only). **`GET /api/crm2/my-case-tasks`** — `collectionGroup('tasks').where('assignedTo','==',caller.fapl)`, filters open+task, returns denormalised label (no extra reads).
- **New collection**: `cases/{caseId}/tasks/{taskId}`. **Rules**: `cases/{id}/tasks/{taskId}` read = `crm.cases.read`||admin, write=false (server-only via Admin SDK). **Index**: COLLECTION_GROUP `fieldOverride` for `tasks.assignedTo` (the cross-case my-case-tasks query; emulator doesn't enforce it but prod needs it).
- **UI** — case workspace gains a **"Collaboration" tab** (`CollaborationTab` in `CaseWorkspacePage`): collaborators chips + a `MultiSearchableSelect` add/remove (admin/manager/owner) + the thread (post update / create task with assignee / checkbox mark-done). **`TasksPage`** (`/crm/tasks`) gains a **"Case Tasks" tab** (`CaseTasksSection`) listing open tasks assigned to me across all cases via `GET /api/crm2/my-case-tasks`, each linking to its case. The Phase 1d "Coming soon" stub is removed.
- **Gate**: `.qa/crm2-phase6-gate.mjs` (10/10): owner/admin set collaborators (deduped, handlingRm stripped); non-owner/non-manager perm-holder blocked 403; update + task post; task surfaces in my-case-tasks cross-case; mark-done drops it from the open list.
- **Deployed (2026-06-17):** merged to main (`cd24975`); `deploy:rules` (new `tasks` block → ruleset `062dd0b2`) → `deploy:indexes` (`tasks.assignedTo` CG override registered on `pulse`) → `gcloud run deploy pulse-api --source . --no-cpu-throttling` (**revision `pulse-api-00053-hfw`**, 100% traffic) → `npm run deploy` (hosting) → `verify:deploy` **3/3 green**. **CRM 2.0 Business-Requirements Update is now FEATURE-COMPLETE (Phases 1–6 all live).**

### 10-stage clickable case pipeline (2026-06-17) — case workspace now shows the full spec lifecycle
**Why:** the spec ("New Updated…") describes a **10-stage case lifecycle**; the build had shown only the 5 case-level stages (the per-login stages 4–9 lived inside the Logins tab), so users saw 5. This adds the full **10-stage clickable pipeline** as the working surface — click any stage → its workspace → a "Submit & advance" button at the bottom — **as a presentation layer over the existing per-login engine** (multi-login + money pipeline untouched). tsc + build clean; gates green (phase3 12/13 env · phase4 24 · phase4a 11 · phase4-money 13 · phase5 12 · phase6 10); **167 unit tests** (+5 casePipeline); Stage-2/3 field smoke green.
- **Types** (`src/types/crm2.ts`): `CASE_PIPELINE` (the 10 display stages — 1-3 + 10 case-level, 4-9 per-login) + `activeCasePipelineStage(caseStage, loginStages)` (derives the current stage; during IN_PROGRESS points at the earliest-active login = the bottleneck) + tests (`src/lib/crm2/casePipeline.test.ts`). New case fields `eligibility` (`CaseEligibility`) + `docsFolderUrl`. **Engine unchanged** — `CaseLevelStage`/`LoginStage` machines + transitions are exactly as before; this is display + 2 forms.
- **Server** (`server/crm2.ts`): `eligibility` + `docsFolderUrl` added to `CASE_EDITABLE_FIELDS`; `sanitizeEligibility` (cibilTaken + bounded issues table); both default `null` at case-open. No stage-machine change.
- **UI** (`CaseWorkspacePage.tsx`): the 5-stage stepper + 7-tab row replaced by a **10-stage clickable stepper** + a `stagePanel(n)` workspace + 4 cross-stage **glance tabs** (Details · Collaboration · Client-ID · History). Stage 1 = amount + Applicants + Stage-1 underwriting; **Stage 2 = new `EligibilityPanel`** (CIBIL taken + overdue/settlement/written-off/DPD issues table); **Stage 3 = new `DriveLinkCard`** (Google-Drive client-folder link, folder = client id) + the document tracker; Stages 4–9 = the per-login `LoginsSection` with a "worked per login" banner; Stage 10 = completion. Case-level stages (1→2→3→IN_PROGRESS→Completed) advance via the bottom button; stages 4–9 advance per-login. Any stage is clickable/editable any time (decision F). No rules/index change.
- **Still a fast-follow (named gaps, not blocking):** richer applicant form fields (DOB/email/address/occupation/income/CIBIL are in the type but not yet in the add-applicant form), the Stage-3 "received/OK/uploaded" 3-state per doc, and dedicated valuation amount+property fields in Stage-6 sub-processes.
- **✅ DEPLOYED TO PRODUCTION (2026-06-17):** merged to main (`6cbb457`); `gcloud run deploy pulse-api --source . --no-cpu-throttling` (**revision `pulse-api-00054-k5j`**, 100% traffic) → `npm run deploy` (hosting) → `verify:deploy` **3/3 green** (rules unchanged — ruleset `062dd0b2`).
- **UI redesign (2026-06-18, hosting-only, `1f0650e`) — view polish, ZERO logic change** (only `CaseWorkspacePage` + `LoginsSection`): back button moved into the header as a circular icon button; the 10-stage stepper gains **blue notification badges on the per-login stages** (count of banks active at that stage, hover = bank names) + a header "N banks active" chip; login tiles rebuilt as clean stacked cards with a state accent bar, an id·branch·amount line, and a **dot-line progress indicator + "Step N/7"** (replaced the text chips) — professional + mobile-friendly. All handlers/API/advance logic untouched.
- **CRASH FIX (2026-06-18, hosting-only) — case page React error #310** (`CaseWorkspacePage.tsx`): the redesign's `activeBanksByStage` `useMemo` (login-count stepper badges) was placed **AFTER** the `if (!caseDoc) return <Loading>` early-return. On the loading render the hook was skipped; once the case snapshot arrived it ran → hook count changed → React #310 ("rendered more hooks than the previous render"), caught by `RouteErrorBoundary` as a full-page crash on `/crm/pipeline/cases/:id`. Fixed by moving the `useMemo` **above** the early return (it only needs `logins`+`lenders`, both already declared). **Why the build missed it:** `npm run build`/`npm run lint` are **tsc-only — there is NO ESLint config in the repo**, so `react-hooks/rules-of-hooks` never runs; such violations ship as runtime crashes. **Rule: in these components, EVERY hook (incl. `useMemo`) must sit above any early `return`** — a `awk` hook-after-return scan of the file is the quick check.

### Live-audit P0 fixes — vendor-pdf preload + /hr route (2026-06-18, hosting-only)
A browser audit flagged 3 P0s; verifying against the LIVE server resolved one as a false positive and fixed two:
- **Compression (FALSE POSITIVE — no work):** the audit saw `encodedBodySize === decodedBodySize` and concluded "no gzip/brotli". That's the **PWA service worker serving decompressed cached responses**. A real `curl -I -H "Accept-Encoding: br"` against `pulse.finvastra.com/assets/*.js` returns **`Content-Encoding: br`** (index chunk 83 kB over the wire) + **`Cache-Control: max-age=31536000, immutable`**. Already optimal.
- **vendor-pdf preloaded on every load (FIXED):** `vendor-pdf` was an **object-form `manualChunks`** entry (`vite.config.ts`), which Vite emits as a `<link modulepreload>` in the entry HTML — so ~128 kB gz of jspdf was preheated on the home/module-picker though it's only used by lazy PDF routes. **Removed `vendor-pdf` from `manualChunks`** → Rollup hoists jspdf into a **single shared ASYNC chunk** (`jspdf.es.min-*.js`, verified not duplicated) loaded on demand. Entry modulepreload now: vendor-react/firebase/firestore/ui only.
- **`/hr` hit the error boundary (FIXED):** there is no `/hr` route (only `/hrms`), so deep-linking `/hr` fell through to "Something went wrong". Added `router.tsx` redirects **`/hr` + `/hr/*` → `/hrms/dashboard`** and a **catch-all `* → /`** (unknown paths go home, not the error screen). `RouteErrorBoundary` now **`console.error`s the underlying error** (path + error) so route failures are diagnosable (it previously swallowed it; the benign stale-deploy chunk case is still skipped).
- Verified: tsc + build clean; `dist/index.html` entry preload no longer lists vendor-pdf; jspdf is one async chunk. Hosting-only (vite.config + router + RouteErrorBoundary). **Remaining audit items (P1/P2 — not yet done):** dashboard skeleton loaders, light-mode "Fin" wordmark contrast, MIS "Archive · Old MIS" nav gating, CRM SLA-overdue count audit (2488/2644 vs 9 active — likely counting old-model/imported leads), mobile re-verify, per-route load/deep-link smoke tests.

## UI/UX Overhaul (2026-06-18, in progress) — plan `~/.claude/plans/eager-noodling-floyd.md`
A phased, professional UI/UX overhaul approved by Rahul: **bigger visual overhaul within the navy/gold brand · unified persistent sidebar + pinned favourites · global command palette · phased rollout**. Phases: 1 registry+palette ✅ · 2 unified sidebar+pins · 3 launcher redesign · 4 design tokens+primitives · 5 dashboard redesigns · 6 (opt) cross-device pins. Guardrails: ~100 routes never change (the registry only *describes* them); **no ESLint → manual `awk` hook-after-return scan** on every shared component; theme vars in both `:root`+`body.light-mode`; badge subscriptions stay in shells; "NOTHING LOCKED" preserved; hosting-only except the optional Phase 6 rules deploy.

### Phase 1 ✅ DEPLOYED (2026-06-18, hosting-only, verify:deploy 3/3) — unified nav registry + global ⌘K command palette
- **NEW `src/config/navigation.ts`** — the spine: one source-of-truth registry (`NAV_NODES`, **78 nodes** across all 5 modules) each `{key,label,route,module,icon(string),group,keywords?,badgeKey?,access:(ctx)=>bool}`. `buildNavCtx(user,profile)` centralises the exact booleans the shells compute (isAdmin/isSA/isHrmsManager/isMisAdmin/isCrmManager/hrms·crm·misAccess/crmCanImport/perms); reusable predicates mirror the live gates (HRMS admin `isAdmin||isHrmsManager`, CRM Pipeline `isAdmin||perms['crm.leads.read']`, MIS archive `isMisAdmin`, etc.). Also `MODULES`/`MODULE_ACCENTS` (ONE accent map → imported by launcher + AppsMenu to kill the colour drift), `resolveNavIcon`, selectors `accessibleNodes`/`moduleNodes`/`nodeByKey`/`accessibleModules`, `MODULE_GROUP_ORDER` (for the Phase-2 sidebar). **The registry only describes routes — `router.tsx` untouched; a node-script check confirmed all 78 routes resolve to real router paths.** Ported from HRMS `SEARCH_INDEX` + CRM nav + MIS `NAV`; reuses `shareablePages` keys where they overlap.
- **NEW `src/components/ui/CommandPalette.tsx`** — `<CommandPalette/>` (mounted once per shell + launcher; routes are exclusive so only one renders) + `<CommandSearchButton/>` ("Search ⌘K") + `openCommandPalette()`. Opens on **⌘K/Ctrl+K** or the `fv:open-command-palette` window event (header buttons dispatch it — no prop drilling). Fuzzy search (token-substring + prefix ranking over label/keywords/group/module) across **all** modules filtered by `access(buildNavCtx)`, grouped results, full keyboard nav (↑↓/Enter/Esc), **Recents** (`localStorage('fv-cmd-recents')`, last 6), theme-toggle + sign-out actions. Top-anchored sheet, opaque `--ss-bg`, mobile-friendly. All hooks unconditional + top-of-fn.
- **Mounted** `<CommandSearchButton/>` in all 3 shell headers (next to AppsMenu/SharePageButton) + a prominent search bar on the launcher (under the greeting); `<CommandPalette/>` once in each shell + launcher. HRMS sidebar search kept this release (remove next). **No routes/rules/index change.** tsc+build clean; hook-scan clean.

### Phase 2 ✅ DEPLOYED (2026-06-18, hosting-only, verify:deploy 3/3) — unified persistent sidebar + pinned favourites (all 3 shells)
One sidebar pattern across HRMS/CRM/MIS, driven by the Phase-1 registry. Rolled out CRM (`7871a4a`-era commit) → MIS+HRMS in one follow-up; all 3 live.
- **NEW `src/features/auth/hooks/useUiPrefs.ts`** — pins + per-module open-sections, **localStorage-backed** (`fv-ui-prefs`) via `useSyncExternalStore` so every consumer (sidebar rows, pin buttons) stays in sync without prop-drilling. Pins are registry **keys** (unknown keys drop cleanly); `openGroups(module)` falls back to `DEFAULT_OPEN_GROUPS` (CRM: Dashboard/Workspace/Customers/Pipeline/Teams open, Admin closed · HRMS: the 5 self-service groups open, admin sections closed · MIS: 'MIS' open, 'Archive · old MIS' closed). Cross-device sync is the optional Phase 6 (add `'uiPrefs'` to the `/users` rules allowlist).
- **NEW `src/components/ui/PinButton.tsx`** — star toggle (appears on nav-row hover).
- **NEW `src/components/layout/ModuleSidebar.tsx`** — the shared sidebar body: a **Pinned** section on top (current-module pins) + grouped **collapsible sections** from `moduleNodes(module, navCtx)`. Single-item groups render flat (matches the old CRM Dashboard/Customers). Active styling/markup identical to before (gold left-border). **Badges stay computed in the shells** (their live subscriptions) and are passed in: `itemBadges` (route→`number | {count,color}`) + `sectionBadges` (group→`{count,color}`, summed on the header). `data-tour` anchors preserved via `NODE_DATA_TOUR` so guided tours keep working. All hooks unconditional + top-of-fn.
- **Shells rewired**: each shell computes `navCtx = buildNavCtx(user, profile)` + its badge maps, then renders `<ModuleSidebar module=… navCtx=… pathname=… itemBadges=… sectionBadges=… />` in place of its bespoke nav. **Item parity verified per role** vs the old nav (CRM Dashboard/Workspace/Customers/Pipeline[perm]/Teams[manager/import]/Admin[admin]; HRMS all ~16 badges reproduced exactly — section sums gold/red/amber + per-item coloured; MIS primary + admin-only archive). Referral-only / share-only / viewer / MIS-viewer branches **unchanged**. The dead `NavItem.tsx`, the now-unused per-shell `NavGroup`/`NavSection`/`ADMIN_NAV`/`SEARCH_INDEX`/HRMS sidebar-search, and stray icon imports are **left for a cleanup commit** (tsc clean — no `noUnusedLocals`; tree-shaken from the build). **No routes/rules/index change.** tsc+build+hook-scan clean.
- **Maintainer: hard-refresh (Ctrl+Shift+R) to clear the PWA cache**, then each module's sidebar shows the same grouped pattern; hover any item → ★ to pin it to a "Pinned" section at the top; open/closed sections persist per device.

### Phase 2 cleanup ✅ DEPLOYED (2026-06-18) — removed HRMS sidebar search + dead nav code
With ⌘K + the unified sidebar live, deleted the redundant/dead code: HrmsShell's sidebar "Search menu" box + its state, the `SEARCH_INDEX`/`SEARCH_GROUP_ORDER`/`SearchItem` registry, the `navLink` renderer, the `NavSection` component, `sectionForPath`/`openSections`/`toggleSection` + auto-open effect; CrmShell's now-dead `NavGroup` + `ADMIN_NAV`; and the unused file `src/components/layout/NavItem.tsx` (deleted). All 3 sidebars are now one identical pattern (no per-shell search box). tsc+build clean.

### Phase 3 ✅ DEPLOYED (2026-06-18, hosting-only, verify:deploy 3/3) — launcher/home redesign
`src/features/home/LauncherPage.tsx` rebuilt off the registry: module tiles come from `MODULES` with **consistent per-module accents** from `MODULE_ACCENTS` (HRMS blue · CRM gold · MIS green · Command purple · LMS pink — fixes the old navy/green/purple/gold drift); each tile's icon tint + CTA use its accent. Tile visibility = the registry access predicate OR a held page-share (Phase-P preserved). NEW **"Quick access"** row = your **Pinned** pages (★, from `useUiPrefs`) + **Recents** (from the command palette's `getCommandRecents()`), filtered to what you can open. Search bar (→ ⌘K) kept central; SA "Shares" moved to the top bar; profile-load-fail / mustResetPassword / zero-access states preserved. **`AppsMenu` accents repointed to the same `MODULE_ACCENTS`** so the switcher and launcher agree on each module's colour. `CommandPalette` now exports `getCommandRecents()`. No routes/rules/index change. tsc+build+hook-scan clean.

### Phase 4 ✅ DEPLOYED (2026-06-18, hosting-only, verify:deploy 3/3) — design tokens + shared primitives
- **`glass.css`** — ADDITIVE design-scale tokens in BOTH `:root` and `body.light-mode` (no existing var renamed): `--text-secondary`, `--radius-sm/md/lg/xl`, `--elev-1/2/3`, `--ring-focus`. Feature cards (`.glass-card`) now carry a subtle `--elev-1` lift; new opt-in helpers `.glass-elevated` / `.h-display` (Fraunces editorial face) / `.h-section` (uppercase label).
- **NEW `src/components/ui/primitives.tsx`** — the reusable set pages adopt so the look stops being hand-rolled: **`PageHeader`** (editorial title + subtitle + actions + optional ★ pin via `pinKey`), **`Card`**, **`Section`**, **`StatCard`** (unified KPI card; `color` alias keeps existing call sites working; loading skeleton), **`Toolbar`**. Theme-aware, no logic.
- **Adoption (Phase 5 start)**: the **CRM dashboard** now uses `<PageHeader pinKey="crm.dashboard">` (header is pinnable) + the shared `StatCard` (its duplicated local copy removed). **HRMS/MIS dashboards keep their current headers** (HRMS is a deliberately larger personalised greeting; MIS's primary surface is `/mis/cases-mis`) — adopt the primitives there incrementally as those pages are next touched. No routes/rules/index change. tsc+build+hook-scan clean.
- **Remaining: Phase 5 (further dashboard adoption of the primitives) · optional Phase 6 (cross-device pins via a one-line rules deploy).** The structural + navigational overhaul (Phases 1–4) is complete and live.

### Phase 5 ✅ DEPLOYED (2026-06-18, hosting-only, verify:deploy 3/3) — dashboards adopt the primitives
- **HRMS dashboard**: greeting header → `<PageHeader pinKey="hrms.dashboard">` (now pinnable); the duplicated **local StatCard removed** for the shared primitive (which gained an optional `link` prop so `link=`/`onClick=` both work). The 2 stat accents switched off the **dark-invisible navy/dark-green** (`#0B1538`/`#166534`, which the old local card silently ignored) to theme-safe **blue/green** (`#5B9BD5`/`#34A853`) now that the shared card honours `accent`.
- **MIS overview**: header → `<PageHeader pinKey="mis.overview">` with the month picker as the `actions` slot.
- CRM dashboard already adopted in Phase 4. No routes/rules/index change. tsc+build clean.

### Phase 6 ✅ DEPLOYED (2026-06-18) — cross-device pins (the overhaul's only rules change)
Pinned pages + open sidebar sections now follow the user across devices. **`deploy:rules` → verify → hosting** (new ruleset `76097565…` bound to `pulse`, verify:deploy 3/3).
- `src/features/auth/hooks/useUiPrefs.ts` — `commit()` now also calls a registered `cloudWrite`; `localStorage` stays the instant, offline-safe primary. **`hydrateUiPrefsFromCloud(remote)`** adopts another device's prefs with a **JSON-equality guard** → loop-safe (our own write returns via the profile snapshot, compares equal, no-op).
- NEW **`src/features/auth/UiPrefsCloudSync.tsx`** (mounted once in `App.tsx` inside `AuthProvider`) — registers a writer that `updateDoc(users/{uid}, {uiPrefs})` while signed in, and hydrates from the live `profile.uiPrefs` snapshot.
- `UserProfile.uiPrefs?` added (`{pins?, openSections?}`); **`firestore.rules` `/users` self-update allowlist gains `'uiPrefs'`** (precedent: `onboarding`). This is the ONLY rules change across the whole UI/UX overhaul.

**UI/UX OVERHAUL COMPLETE — all 6 phases live** (command palette · unified sidebar+pins · launcher redesign · design tokens+primitives · dashboard adoption · cross-device pins).

## Report visualisation — Table ⇄ Graph + Share (2026-06-18) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Graphical representation of the manager/director reports, **presentation-only** (no business logic, queries or money-gates touched — charts render already-computed data). Each report's data series gets a **Table ⇄ Graph toggle**: **graph is the default on mobile** (reads better on a phone), **table on desktop**, both switchable, and the choice is remembered **per breakpoint** (`fv-report-view-{m|d}` localStorage). The **Share** is the existing Phase-P page-share (grant a colleague access; SA-only, self-hides otherwise).
- **`recharts` ^3.8** added — isolated in its own async `charts-*.js` chunk loaded ONLY on report pages (NOT in the entry/preload; confirmed via `dist/index.html`). Do NOT add it to vite `manualChunks` (object-form chunks get modulepreloaded everywhere — the vendor-pdf lesson).
- **NEW `src/components/ui/charts.tsx`** — themed Recharts wrappers `ReBar` (vertical/horizontal, grouped/stacked) · `ReLine` · `ReArea` · `RePie` (donut), in the navy/gold palette (`CHART_COLORS`), theme-aware (axis/grid/tooltip use CSS vars), responsive (`ResponsiveContainer`), with `fmtINR`/`fmtNum` + a branded tooltip.
- **NEW `src/components/ui/DataView.tsx`** — the Table⇄Graph toggle card (title + switcher + optional per-report `<SharePageButton>`), plus a **`headless`** mode to drop a toggle *inside* an existing section (no double-card / preserves scroll refs), and `SimpleTable`/`Column<T>` for the table view.
- **Reports converted** (all 6): **CRM 2.0 Dashboards** (`crm2/dashboards/DashboardsPage.tsx` — every series: leads by source/category, pipeline by stage, payout health, disbursed/margin/receivables by connector, RM + sub-DSA scorecards; money series keep `canMoney`) · **Command Centre** (`CommandCentrePage` — pipeline-by-line / attendance / compliance donuts) · **CRM Dashboard** (`CrmDashboardPage` — Source breakdown donut) · **Lead Aging** (bucket donut; cards stay the interactive filter) · **Targets** (team grouped bar: disbursed actual vs target per RM; table keeps edit/scorecard actions) · **MIS overview** (disbursals tab — "Disbursed by Sub DSA" donut).
- **New shareable page**: `crm.crm2-dashboards` → `/crm/pipeline/dashboards` added to `shareablePages.ts`. No rules/index/server change. tsc + build + hook-scan clean.

### CRM dashboard rename + reposition (2026-06-18) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
The two CRM dashboard surfaces had confusing names ("Dashboard" vs "CRM 2.0 Dashboards"). Renamed + re-IA'd (labels/titles only — routes unchanged):
- **`/crm/dashboard`** (daily operational snapshot) → **"Overview"** (`crm.dashboard` registry label; CrmShell `PAGE_TITLES` + mobile tab; page header stays "CRM Overview").
- **`/crm/pipeline/dashboards`** (the CRM 2.0 funnel/financial analytics) → **"Analytics"** — dropped the internal "2.0". Registry node `crm.dashboards` **moved from the `Admin` group to the top `Dashboard` group** (so Overview + Analytics sit together at the top of the CRM sidebar; access unchanged = `crmAdmin`); icon → `BarChart3`; page header "Dashboards" → "Analytics"; `shareablePages` title → "Analytics". The CRM sidebar's "Dashboard" group now has 2 items (renders as a collapsible section, open by default). No rules/index/server change.

### Sidebar cleanup — distinct icons · clearer labels · HRMS group consolidation (2026-06-18) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Audit of the unified nav registry (`navigation.ts`) found duplicated icons, confusing labels, and HRMS group sprawl. Fixed (presentation-only — no routes/access/logic):
- **Distinct icons** — the 6 identical gear (`Settings`) icons in CRM Admin now differ (Masters `Layers` · Commission Leakage `AlertTriangle` · Competitor Intel `Eye` · Referral Intel `Share2` · Access Logs `ScrollText` · Right to Erasure `Trash2`); the `TrendingUp` overload split (My Review `ClipboardCheck` · Claims Analytics `PieChart` · Salary History `Banknote` · Performance Reviews `Award` · CRM Customers `Contact` · Lead Aging `Hourglass`); MIS rupee/bar overload split (Case Financials `FileSpreadsheet` · RM Payouts `Banknote` · Commissions `Wallet`). New icons added to the `navigation.ts` lucide import + `NAV_ICONS` resolver.
- **Clearer labels** — CRM "Reports" → **"Lead Aging"**; CRM "Permissions" → **"CRM Permissions"** (vs HRMS "Permission Manager"); the MIS item literally named "MIS" (`/mis/cases-mis`) → **"Case Financials"** (also `MisShell` PAGE_TITLES + "Financials" mobile tab). **Customers vs Leads** disambiguated by icon (`Contact` vs `Inbox`) + keywords (Customers = cold/prospects; Leads = qualified/crm 2.0) — labels kept ("Customers" = cold dump, "Leads" = CRM 2.0 qualified).
- **HRMS groups 13→11** — folded **Statutory** into **"Payroll & Compliance"** (was "Payroll & Finance"); renamed **"Content" → "Communications"**; moved **"HR Helpdesk — Admin"** out of Performance into **People**. `MODULE_GROUP_ORDER.hrms` updated; `DEFAULT_OPEN_GROUPS` unaffected. No rules/index/server change.

### Floating bottom bars + Toast — dark/light readability fix (2026-06-18) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
The floating bottom bars + the success-toast hit the **theme rule #2** bug ("a `var(--text-*)` on a FIXED-colour surface breaks in one theme"). Fixed all four to a single **opaque theme-aware surface** (`var(--ss-bg)` — navy in dark, white in light — so the `--text-*` vars on them resolve correctly in both):
- **`Toast.tsx`** — bg was hardcoded `bg-white` while the message used `var(--text-primary)` → **cream-on-white = invisible in DARK mode**. Now `bg-(--ss-bg)`; title tones `-700→-600` (read on navy + white). (Toast is bottom-RIGHT.)
- **`BulkActionBar.tsx`** (CRM bulk-select) — fixed navy `#0B1538` + `var(--text-muted)` controls → **dark-on-navy = unreadable in LIGHT mode**. → `--ss-bg` / `--shell-border` / `--text-primary`.
- **Permission Manager save bar** (`SuperAdminPermissionsPage.tsx`, the super-admin "N changes / Not yet saved" bar, offset under the sidebar) — same fixed-navy bug → `--ss-bg` (keeps the gold "unsaved" accent border); divider → `var(--shell-border)`.
- **Employees bulk "N selected" tick bar** (`EmployeesPage.tsx`) — was translucent `glass-panel` → same opaque `--ss-bg` so all floating bars match.
**Rule reminder:** a floating bar gets EITHER a fixed-colour surface with fixed-colour text, OR a theme-aware surface (`--ss-bg`) with `var(--text-*)` — never a fixed surface with theme-var text. Presentation-only.

### Render-performance fix — LCP render-delay (2026-06-18, hosting-only)
A DevTools trace flagged **LCP ≈ 1.7 s, 99.7 % render DELAY** on a CRM list page (the `h2.text-3xl` header), main-thread long tasks + layout thrash. An earlier "perf audit" only checked **bundle size** (small) and missed the real RENDER drivers. Fixes (presentation/loading-only — **no logic/rules/data change**):
- **Fonts (biggest, zero-risk):** Google Fonts were loaded via **`@import` inside the bundled CSS** (serial: download CSS → parse → fetch fonts) with **no preconnect**. Moved to a **parallel `<link rel="stylesheet">` in `index.html` `<head>`** + `<link rel="preconnect">` to `fonts.googleapis.com`/`fonts.gstatic.com`; removed the `@import` from `src/styles/tokens.css`. The font now fetches in parallel on a warmed connection; `display=swap` (kept) keeps text visible. Helps text paint on **every** page.
- **Mount-time Firestore contention (CaseWorkspacePage):** the case page fired ~12 concurrent listeners on mount (~9 whole-collection). Added an **`enabled` param** to the hooks (`useCrm2Collection` `src/features/crm2/lib.ts`, the local `useSubcollection`, `useAllEmployees`, `useConnectors` — all default `true`, every existing caller unaffected) and **lazy-load each master/subcollection only when its view is active** (documentMaster/docTracker/vaultDocs → Documents; aggregators/connectors → Details; employees → Collaboration; applicants → Stage1/Docs; stageHistory → History). Eager (header/badges): caseDoc/client/payout-mirror + logins + lenders. Drops mount listeners to ~3-4; each view still gets its data the moment it opens (no behaviour change).
- **Deferred (not done, needs care):** the same `enabled`-gating on the heavy list pages (`Crm2LeadsPage`/`Crm2CasesPage`) — requires per-page verification of which masters feed the table (e.g. RM-name lookups) vs dialogs before gating; the font fix already covers those pages' text paint.
- **Verified:** tsc + build clean; `dist/index.html` head has preconnect + parallel font `<link>`, bundled CSS no longer carries the `@import`; gates phase2 31/31, phase3 12/13 (env GCS), phase6 10/10 (no regression). **Hosting-only** (no server/rules/index change). **Re-measure after deploy** (the step skipped before): re-run the DevTools/Lighthouse trace — font request should now start in parallel (~0 ms in the waterfall).
- **DEPLOYED 2026-06-18 (`b5cd77b` LCP + `fed877b` P0, hosting-only, `verify:deploy` 3/3 green).** P0 follow-on (`fed877b`): **jspdf removed from the object-form `manualChunks`** — as a static manual chunk it was emitted as a `<link modulepreload>` in the entry HTML and preheated on every load (~128 kB gz) though only lazy PDF routes use it; left to Rollup it hoists into a shared **async** chunk (`jspdf.es.min-*.js`) loaded on demand — never on the home/critical path. Also: **`/hr` + `/hr/*` redirect → `/hrms/dashboard`** and a catch-all `*` → `/` (broken bare-`/hr` links 404'd); `RouteErrorBoundary` now `console.error`s the real error (default boundary swallowed it).

### P1 UX-polish pass (2026-06-18, hosting-only) — ✅ DEPLOYED (`7871a4a`, verify:deploy 3/3)
Four presentation/data-display fixes (no server/rules/index change):
- **Light-mode logo contrast** — the 3 shells now pass `dark={theme === 'light'}` to the header `VideoLogo` (`useTheme()`), so the navy "Finvastra" wordmark is legible on the light-mode header (was white-on-white; `VideoLogo` defaults `nameColor` white). The `FullPageLoader` logo stays white (on fixed `--navy-deep`).
- **MIS "Archive · old MIS" nav hidden from non-admins** (`MisShell.tsx`) — `visibleNav` now also drops `section === 'archive'` entries unless `isMisAdmin`. The legacy old-MIS pages (Overview/Statements/Reconciliation/Disputes/RM-Payouts/Commissions/Slabs/Templates), superseded by CRM 2.0, stay routable for admins but no longer clutter a regular user's sidebar.
- **CRM-dashboard SLA-overdue count fixed** (`CrmDashboardPage.tsx` `leadStats`) — was summing the **entire `/leads` inventory** (`filter(!deleted)`) and flagging any past `slaDeadline`, so it read ~2488/2644 (dominated by the closed + undistributed **bulk-import backlog** given a +24h SLA at import and never worked). Now: "active" excludes closing dispositions + converted (`not_interested`/`no_response`/`wrong_number`/`converted`), and **overdue counts only OWNED, open leads** (`primaryOwnerId` set and ≠ `'UNASSIGNED'`) past SLA — the actionable "needs follow-up" figure. Undistributed imports surface on the Import Queue, not the dashboard. **No SLA-engine change** — this is a dashboard-display scope fix only; the real two-stage SLA sweep + real-contact deadlines are untouched.
- **Dashboard skeletons** — CRM `StatCard` gained a `loading` prop rendering a pulse bar instead of `'…'`; HRMS `StatCard` already had it, so the dead `'…'` ternaries were dropped. Header subtitle no longer prints "Loading…".

### Super-admin profile auto-heal + mobile vertical case-stage timeline (2026-06-18, hosting-only) — ✅ DEPLOYED (verify:deploy 3/3)
Two follow-ups after the user (a super-admin) reported the profile STILL blank and the mobile 10-stage view "not apt".
- **Profile auto-heal:** the 3 founding super-admins (`SUPER_ADMIN_UIDS`) were bootstrapped without HRMS employee fields, so nothing ever populated their name/code/dept/designation and the only fix was hand-entry. Added **`SUPER_ADMIN_PROFILES`** (canonical `employeeId`/`displayName`/`department`/`designation` for FAPL-000/003/022) in `src/config/hrmsConfig.ts` + **`healSuperAdminProfile()`** in `AuthContext.tsx`: on profile load, any MISSING field (or a `displayName` still equal to the email prefix) is written via the admin path (super admins are admins) — **idempotent** (once filled the condition is false → never loops), **non-fatal** on failure. So their profiles **self-populate on next load**, no manual step; they can still override via "Edit details". (The avatar is the auto dicebear initials SVG — a real photo uploads via the camera badge; it was never actually "missing".) `validCrmRolePair` is NOT a blocker — the Edit-details modal already wrote `/users` via the admin path, so the rule passes for these docs.
- **Mobile case-stage timeline:** the 10-stage pipeline in `CaseWorkspacePage.tsx` was a cramped horizontal 94px-chip side-scroll on phones. Added a **VERTICAL TIMELINE for mobile** (`md:hidden`): a top→bottom rail (numbered/checked circles + connector line, current ringed) with each stage row showing label + "Stage N · current/done · N banks" + a blue bank-count badge / chevron, tappable to open that stage's workspace. Desktop/tablet keeps the horizontal chip path (`hidden md:flex`). Presentation only — no stage-machine/logic change.

### Profile "Edit details" now sets identity/work fields + login block-cards (2026-06-18, hosting-only) — ✅ DEPLOYED (verify:deploy 3/3)
Follow-up after the user reported the profile name was STILL "rahulv". **Root cause confirmed** (not a load bug, not an overwrite): `AuthContext.tsx:162` stamps `displayName: user.displayName ?? email.split('@')[0]` **only on first sign-in** (`if (!snap.exists())`) — so a bootstrapped admin (no Firebase-Auth `displayName`) got "rahulv" once and nothing reverts it; the earlier Employees-edit-modal field could fix it but **the user was on the profile page**, which had no name field. Fix: the profile page's admin **"Edit details" modal** (`EmployeeProfilePage.tsx` `EditProfileModal`) — which previously wrote only a minimal `users.updatedAt` — now has a **"Work Details" section (Full Name · Employee Code · Department · Designation)** writing to `/users` via the admin update path (works for a super-admin editing their own doc; the owner self-update rule also already allows `displayName`). Empty-omit pattern (blank never wipes); `onSave` echoes the fields so the header + Work-Details rows refresh live (no reload). **So a bootstrapped account is now fixable from the profile page itself.** Also: **login cards in `LoginsSection.tsx` rebuilt as distinct bordered block cards** — a header strip (#seq · bank · status · actions) on a subtle band + divider + body (stage progress + key fields), replacing the flat full-width panel; roll-up header unchanged; no logic change. **Maintainer action:** open your profile → "Edit details" → fill Full Name (`Rahul Vijay Wargia`) + Employee Code (`FAPL-022`) + Department/Designation → Save.

### Identity-field backfill for bootstrapped accounts (2026-06-18, hosting-only) — ✅ DEPLOYED (`b7ef15d`, verify:deploy 3/3)
A **bootstrapped super-admin account** (created via Google first-login / `bootstrap-admin`, not "Add Employee" — e.g. `rahulv`) never got the HRMS employee fields: `displayName` stayed the email prefix ("rahulv"), and `employeeId`/`department`/`designation` were unset on its `/users` doc. So **its own `EmployeeProfilePage` showed blank Work Details** (Employee Code/Department/Designation `—`) and — because `useEmployeeProfileDoc(displayProfile?.employeeId)` keys on the missing `employeeId` — could never load `employee_profiles`. This was a **data gap, not a load failure** (other profiles loaded fine), and **no UI existed to set `displayName` or `employeeId`** (the profile page's admin "Edit details" only writes `user_details` + `employee_sensitive` + a minimal `users.updatedAt`; the Employees edit modal set department/designation but not name/code). Fix: the **Employees edit modal** (`EmployeesPage.tsx` `EditEmployeeModal`, admin-only — the Edit pencil is shown for any admin incl. on SA rows; only Exit/Reactivate is SA-gated) now exposes **Full Name + Employee Code** inputs. Both use the **empty-omit pattern** (a blank field never overwrites existing data), so it's a safe identity backfill; setting Employee Code also unblocks the profile page's `employee_profiles` load + the salary/bank "Edit details" section. **Maintainer action:** open `/hrms/employees` → edit the affected account → fill Full Name (`Rahul Vijay Wargia`) + Employee Code (`FAPL-022`) + Department/Designation → Save (AuthContext's live `/users` listener reflects it immediately). No server/rules/index change.

### Consistent lead codes — LD-YYYY-##### for every lead (2026-06-18)
**Why:** natively-created CRM 2.0 leads use an `LD-YYYY-#####` **doc id**, but **promoted Customers keep their original random Firestore id** (the "one record, no duplicate" rule — a doc id can't be renamed without orphaning its activities), so the Leads list showed a mix of `LD-2026-####` and random strings. Fix = a **`leadCode` display field** carried by every lead. tsc + build clean; phase2 31/31 + phase6 10/10 (no regression); leadCode smoke green (native `leadCode==id`, promote mints `LD-2026-#####` while keeping the doc id, backfill idempotent).
- **Types** (`Crm2LeadFields.leadCode?`): human-friendly code shown in the UI.
- **Server** (`server/crm2.ts`): every native lead create (public/website, internal, Meta) sets `leadCode: newId` (= the LD- doc id); **promote** mints a separate `leadCode` from the shared `leads-YYYY` counter (returns it); new **`POST /api/crm2/admin/backfill-lead-codes`** (admin/manager) — idempotent one-time backfill that links native ids (`leadCode=id`) and mints codes for promoted/random-id leads (returns `{coded, minted, skipped}`).
- **UI** (`Crm2LeadsPage`): list + drawer show `leadCode ?? id`; an admin **"Assign LD- codes"** button appears in the header only while leads still lack a code → calls the backfill (the snapshot refresh hides it once done).
- **✅ DEPLOYED TO PRODUCTION (2026-06-18):** merged to main (`f51d1bc`); `gcloud run deploy pulse-api --source . --no-cpu-throttling` (**revision `pulse-api-00055-7fr`**, 100% traffic) → `npm run deploy` (hosting) → `verify:deploy` **3/3 green** (rules unchanged — ruleset `062dd0b2`). **Maintainer action: open CRM → Leads and click "Assign LD- codes" once** to backfill the already-promoted leads (new leads/promotions are coded automatically; safe to skip otherwise).
- **Gotcha for emulator gates**: the dev server MUST be started with `GCLOUD_PROJECT=demo-pulse` in ITS shell — without it the Admin SDK verifies tokens against the wrong project and every authed call 401s (each Bash call is a fresh shell; env doesn't persist from the emulator-start command).

### Final hardening + orchestration audit (2026-06-17) — ✅ DONE
A whole-system "no-pending / no-duplication / no-broken-logic" pass after Phase 6.
- **Scheduler orchestration — now 16/16 jobs ENABLED & reachable.** Audited every scheduled-job endpoint (`/api/admin/run-*` + `/api/crm2/jobs/run-*`) against Cloud Scheduler: 15 were already wired; the only gap was **`crm2-meta-retry`** (`*/10 * * * *` → `/api/crm2/jobs/run-meta-retry`, asia-south1, OIDC SA `787616231546-compute@…`) — **registered + force-run smoke-tested → Cloud Run 200** (the Meta *pipeline* stays dormant until the maintainer's Meta dev account exists, but its retry orchestration is now live & idempotent). Full job list: bank-sla-check · document-expiry-check · commission-leakage-check · monthly-scorecards · daily-rm-briefing · followup-check · callback-reminders · weekly-team-digest · leave-year-end-reset · crm-meeting-reminders · crm2-payout-reminders · crm2-vault-expiry · crm2-recon-snapshots · crm2-lead-sla-sweep · crm2-followup-reminders · crm2-meta-retry.
- **Dead code removed**: `computeSlaDeadline()` in `src/lib/slaUtils.ts` (calendar-only, **zero importers**, superseded by the working-time engine `src/lib/crm2/{sla,businessHours}.ts`). `formatSlaStatus()` kept (still used by LeadDetailPage/MyQueueRow). Hosting-only change.
- **Audit findings deliberately NOT changed (with reason)**: (1) the old `/api/leads/intake/meta` route stays as a no-op 200 fallback — its removal branch `chore/remove-legacy-meta-intake` merges only AFTER a real Meta lead flows through the new endpoint (per runbook; Meta is dormant). (2) CommandCentre/CrmDashboard dashboard reads are **one-shot aggregation `getDocs`** — adding `limit()` would silently UNDERCOUNT at scale (a logic break); correct fix is server-side rollups (a future feature), and at current scale the reads are cheap. (3) Upload paths were audited and are already correct — profile photos upload only the **compressed** blob and abort on failure (no original ever uploaded); ClaimsPage rejects >10 MB at pick time before compression. (4) The dual lead/CRM/MIS models are intentional additive migrations, not duplication. (5) Heavy libs (xlsx/jspdf/firestore) are already isolated in `vendor-*` chunks — initial entry is 315 kB / **97 kB gz**.
- **Config seed** (`app_config/{sla,business_hours,queues}`) not run here (no ADC in the sandbox) — **the code defaults are already live and functional**, so this is optional tuning, not a fix.
- **Full verification green**: tsc clean · build clean · **all 8 CRM 2.0 phase gates** (phase1 12 · phase2 31 · phase3 12/13 [the 1 fail is the env-only GCS vault upload, no ADC] · phase4 24 · phase4a 11 · phase4-money 13 · phase5 12 · phase6 10) · **162 unit tests** (covers the sla/queue/meta/businessHours/slab/channel-partner pure logic). Deploy: hosting-only (`npm run deploy` → `verify:deploy`).

---

## Meta Lead Ads → CRM 2.0 webhook — Phase 1 (capture + queue) (2026-06-16) — DEPLOYED 2026-06-17, DORMANT

> **Deploy status (2026-06-17):** code is **LIVE in prod** (rev `pulse-api-00049-nwc`, ruleset `6450072d`, `meta_lead_events`/`meta_lead_deadletters` indexes READY). **Wiring (2026-06-18, WIRED & VERIFIED — pending one test lead):** Meta app **"App leads"** (App ID `1329929825237970`, Finvastra Advisors business; **the duplicate "App leads" was DELETED**). Use cases: Capture-leads + **Manage everything on your Page** (the latter exposes **`pages_manage_metadata`** — Lead Ads needs all 4: `leads_retrieval`+`pages_show_list`+`pages_read_engagement`+`pages_manage_metadata`; without `pages_manage_metadata` the Lead Ads Testing Tool reports **"Required permissions are missing for the app"** and Meta refuses delivery). **ALL 4 env vars SET** on Cloud Run (rev **`pulse-api-00058-vdl`**): `META_VERIFY_TOKEN` + `META_APP_SECRET` + `META_GRAPH_VERSION=v23.0` + **`META_PAGE_ACCESS_TOKEN`** = a **long-lived Page token for the Finvastra page** (`812414655293252`), obtained via Graph API Explorer (app `1329929825237970`, all 4 perms granted) → `fb_exchange_token` long-lived → `GET /{page-id}?fields=access_token`. (**System-User-token path abandoned** — Meta's new UI hits a circular "No permissions available / assign an app role" wall.) **Webhook configured + verified live** (handshake 3/3; app subscribed to Page-object **`leadgen`**). **Page subscription VERIFIED**: `GET /{page}/subscribed_apps` returns `App leads (1329929825237970) → subscribed_fields:["leadgen"]`. **DELIVERY PROVEN — but blocked by Dev mode (2026-06-18):** after the `pages_manage_metadata` fix the Lead Ads Testing Tool flipped our app from **"Failure"** → **"Pending"** (Meta now accepts delivery). A signed simulated webhook to `POST /api/webhooks/meta/leadgen` (real `leadgen_id`, HMAC over raw body) returned **`{ok:true,received:1,queued:1}`** — **our pipeline works end-to-end up to the Graph pull.** The pull then **dead-lettered** with the decisive error: **`(#3) Apps in dev mode should only access leads submitted from App special roles (testers, developers, admin)`**. **ROOT GATE: the app is in Development mode → Meta refuses to return REAL public leads.** **TO GO LIVE (required, in order):** (1) **Business Verification** (page shows "Review needed"); (2) **App Review → request `leads_retrieval` Advanced Access** (+ `pages_manage_metadata` if needed); (3) **switch app to Live mode**; (4) re-confirm a real lead lands as `source: ADS`. Until all 4 done, **no real Meta lead can flow** (dev-mode hard limit; Zoho/Buffer work only because they're Live + reviewed). Dev-mode smoke test only works if the lead's submitter is in **App Roles → Roles** (admin/dev/tester). **⚠️ DO NOT remove Zoho Social/Buffer from the page until Pulse is Live + reviewed + confirmed receiving real leads — they are currently the ONLY working capture; removing early loses leads.** Phase-2 routing still needs the **Instant Form to carry a product question**. `crm2-meta-retry` scheduler registered (drains transient pull failures, but NOT the dev-mode `#3` error — that's terminal until Live). **Gotchas learned:** (a) `/me/accounts` returned EMPTY for Kumar even with Page Full access — use **`GET /{page-id}?fields=access_token`** directly; (b) `pages_manage_metadata` is NOT in the leads use case — it needs the **"Manage everything on your Page"** use case (Explorer dropdown → **"Other"** group); (c) dev-mode apps can't pull public leads — **App Review + Live is mandatory** before any real lead flows. Full runbook: `docs/go-live/PULSE-LEAD-PIPELINE.md`.

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

## Two-stage lead SLA engine (2026-06-17) — DEPLOYED TO PRODUCTION ✅ (2026-06-17)

> **Deploy status (2026-06-17):** LIVE in prod (rev `pulse-api-00049-nwc`; new composites `leads(firstContactedAt,converted)` + `leads(firstContactedAt,deleted)` READY; firstContactedAt rules allowlist bound). **Cloud Scheduler `crm2-lead-sla-sweep` registered & ENABLED** (`*/15 * * * *`, asia-south1, OIDC SA `787616231546-compute@…`). Runs notify-only against website/manual/queue leads. **Escalation is DYNAMIC** (active `crmRole:'manager'` → super-admin fallback; no `escalationUids` config — see the dynamic-escalation note below). `app_config/{sla,business_hours}` use code defaults unless seeded via `npm run seed:golive`.

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

## FIFO pull-queue work model (2026-06-17) — DEPLOYED TO PRODUCTION ✅ (2026-06-17)

> **Deploy status (2026-06-17):** LIVE in prod (rev `pulse-api-00049-nwc`; composite `leads(assignedRm,converted,receivedAt)` READY). Queue endpoints + QueuePanel UI live. **Queue config uses the code default (Loans + SIP) until `app_config/queues` is seeded**; the maintainer chose a single shared `['*']` FIFO — seed via `npm run seed:golive` (or set the doc in the console). Telecaller `queueSkills` empty by default = eligible for all.

### Website + Google-Ads intake → Pulse (LIVE 2026-06-17, rev `pulse-api-00050-2zl`)
The website lead form (and Google-Ads landing pages, via UTM) posts to **`POST /api/public/leads`** → CRM 2.0 lead `source:WEBSITE` → **FIFO queue + two-stage SLA**. A **trusted shared-secret** was added: a caller presenting `X-Finvastra-Webhook-Secret == WEBSITE_WEBHOOK_SECRET` **skips the per-IP rate limit** (Apps Script egress shares Google IPs, so the public 20/h cap would drop campaign leads); browser posts (no secret) stay rate-limited + honeypotted (`website` field). `sourceMeta.via = apps_script|web`. **`WEBSITE_WEBHOOK_SECRET` is SET on Cloud Run** (2026-06-17). The site's Google Apps Script keeps its existing email/Sheet logic and additionally POSTs to Pulse (drop-in `postLeadToPulse()` using `PropertiesService` for the secret). Verified end-to-end: a trusted POST created `LD-2026-00005`.

Replaces manager-push as the **default** for warm-inbound CRM 2.0 leads (ADS + public website): they stay unassigned in shared, **oldest-first** queues; a free telecaller pulls the front of the line, which **claims** it (stamps owner + `assignedAt`) atomically at pickup. Manual `PATCH …/leads/:id {assignedRm}` remains the **manager override**. **Cold bulk imports stay on the Import-Queue `distribute` path** (untouched). Sits ON TOP of the SLA engine — `captureAt`/`assignedAt`/`firstContactedAt` unchanged; **Stage 1 now measures time-in-queue (claim latency)**, Stage 2 unchanged.

- **Pure lib `src/lib/crm2/queue.ts`** (14 tests): `QueueDef`, `DEFAULT_QUEUES` (`Loans`→`['LOAN']`/skill LOANS · `SIP`→`['WEALTH']`/skill SIP), `queueConfigFromDoc` (from `app_config/queues`, falls back to defaults), `leadQueueCategory` (explicit `category`, else `inferCategory(sourceMeta.productInterest)`, else GENERAL), `queueMatchesLead` (`['*']`=all), `eligibleQueues`/`leadEligibleForSkills` (**empty/unset `queueSkills` = eligible for ALL**; case-insensitive), `queueForLead`, `isQueueableLead` (ADS/WEBSITE + `receivedAt`).
- **Endpoints** (`server/crm2.ts`, perm `crm.leads.write`/`read`): **`POST /api/crm2/queue/claim`** — oldest unassigned warm CRM2 lead by `receivedAt` across the caller's eligible queues, claimed in a **Firestore transaction** (re-reads in-tx; loser falls through to the next → two concurrent claims never collide); stamps `assignedRm`=caller FAPL + `assignedAt` + `status` NEW→`ASSIGNED`; returns `{lead}` or `{lead:null}`. **`POST /api/crm2/queue/release`** `{leadId,reason}` — owner or manager/admin; `assignedRm`/`assignedAt`→null, `status`→`QUEUED`, **preserves `receivedAt`** (keeps its place), bumps `releaseCount`, sets `lastReleaseReason`, **`queueFlagged:true` + manager bell at `releaseCount>=3`**. **`GET /api/crm2/queue/state`** — per-queue `depth` + oldest-lead working-age (`elapsedWorkingMs`) + wall-age + Stage-1 SLA countdown (reuses the SLA lib) + active telecallers (claimed-but-uncontacted by `assignedRm`); for ~10s client polling.
- **Types**: `Crm2LeadStatus` gains `QUEUED`/`ASSIGNED`; `Crm2LeadFields` gains `firstContactedAt`/`releaseCount`/`lastReleaseReason`/`queueFlagged`; `UserProfile.queueSkills?: string[]`. `LEAD_STATUSES` extended server-side.
- **Index**: `leads(assignedRm, converted, receivedAt)` composite (claim/state FIFO query). **Rules**: queue fields are server-only — they're absent from the leads owner-update allowlist AND CRM 2.0 leads carry no `primaryOwnerId`, so non-admin clients can't update them at all (only `/api/crm2/queue/*` via Admin SDK); `queueSkills` lives on `/users` (admin-write only — not in the self-update allowlist). No rule logic change, only a clarifying comment.
- **Client** (`src/features/crm2/queue/`): `useQueue.ts` (`useQueueActions` claim/release · `useQueueState` 10s poller); `QueuePanel.tsx` mounted on `Crm2LeadsPage` — **"Get next lead"** (serve-don't-browse → claims + opens the lead) for any `crm.leads.write` user + a **manager monitor** (depth/oldest-age/SLA countdown/active reps); a `ReleaseControl` (reason) in the lead drawer when a lead is claimed.
- **Gate** `.qa/crm2-queue-gate.mjs` (`npm run qa:queue`) **18/18**: FIFO oldest-first, **atomic concurrent claims → different leads**, skill gating + empty-skills=all, claim stamps, release→QUEUED + captureAt preserved + flag-at-3, `/state` depth/age/SLA, **SLA regression** (unclaimed still Stage-1 breaches · `firstContactedAt` stamps post-claim Stage 2), live `app_config/queues` reshape (single `['*']` = one shared FIFO). Wired into `.github/workflows/ci.yml`. 150 crm2 unit tests; tsc + build clean.
- **Deploy when maintainer ships**: `deploy:rules` (comment only — verify bind) → `deploy:indexes` (new `leads(assignedRm,converted,receivedAt)` composite READY) → `gcloud run deploy pulse-api --no-cpu-throttling` (3 endpoints) → `npm run deploy` (hosting: QueuePanel) → `verify:deploy`. Optionally seed `app_config/queues` (else DEFAULT_QUEUES) + set `queueSkills` per telecaller (else all-eligible). _Flagged follow-on (not built): richer queue analytics / per-agent throughput dashboard._

---

## Social Media module (6th module) — Phase 1: WhatsApp inbox (2026-06-19) — DEPLOYED + Phase-A VERIFIED end-to-end ✅

> **Phase-A test PASSED (2026-06-19):** a real inbound reply (`from 919701097333` "Hiiiiiii") flowed phone → webhook (`POST 200`) → `processWaMessage` → minted a CRM 2.0 lead (`source WHATSAPP`, mobile 9701097333) → message stored at `/leads/{id}/whatsapp` → visible in `/social/inbox` (event `status:done`). Meta's own US test-number sample (`16315551181`) dead-lettered harmlessly — `normaliseMobile` (India `^[6-9]\d{9}$`) rejects non-Indian senders; **real customers are all Indian numbers, so production never hits this.** Minor fast-follow: mark non-Indian senders as "ignored" rather than dead-letter (avoids alert noise from Meta/international test numbers). Reply-from-Pulse (outbound) within the 24h window is the remaining manual confirm.

> **Deploy status (2026-06-19):** code LIVE in prod — `deploy:rules` (ruleset `4d30bd04`, new `whatsapp_*` blocks + `hasSocialAccess()` + leads-read widening) → `gcloud run deploy pulse-api --source . --no-cpu-throttling` (**rev `pulse-api-00070-2dr`**) with all **4 `META_WHATSAPP_*` env vars SET** (verify token + app secret [reused from "App leads"] + a **temporary** test access token + test phone_number_id `1214945971701134`) → `npm run deploy` (hosting: Social module + inbox) → `verify:deploy` 3/3. **Webhook handshake verified live 3/3** (`GET …/api/webhooks/whatsapp?hub.verify_token=…` → echoes challenge; wrong token / unsigned → 403). Reuses the Meta app **"App leads" (`1329929825237970`)** + a Meta **test sender number**. **REMAINING (Phase A):** Meta API Setup **Step 3 — Configure webhooks** (callback `https://pulse.finvastra.com/api/webhooks/whatsapp` + verify token + subscribe **`messages`**) → send `hello_world` to a verified recipient → reply → confirm it lands in `/social/inbox`. **REMAINING (Phase B, production on 9247519004):** register the real number (Coexistence vs API-only), **permanent** System-User token (`whatsapp_business_messaging`+`whatsapp_business_management`), Business Verification + **App Review** (dev-mode gate — only verified test recipients until Live), update the 2 token/number env vars, register Cloud Scheduler `crm2-whatsapp-retry`. The temp access token expires in 24h.

New **"Social Media" module** at `/social/*` (joins HRMS · CRM · MIS · Command · LMS) — a native WhatsApp two-way chat inbox, the first channel of a module designed to grow (FB/IG Messenger, comments, content). Approved plan `~/.claude/plans/eager-noodling-floyd.md`. **Direct WhatsApp Cloud API** (no BSP/SaaS fee); chat lives in Pulse. Reuses the **exact Meta leadgen webhook engine** (HMAC-over-raw-body via `verifyMetaSignature`, write-ahead store, ACK-fast→async-process, retry+dead-letter). **No AI/bot** (human inbox). tsc + `build` clean; **174 unit tests** (+7 new in `src/lib/crm2/whatsapp.test.ts`); hook-scan clean. **Cost:** Meta — receiving + replying within 24h = FREE; only proactive templates charged. GCP — marginal (reuses Cloud Run + Firestore; ~₹100-300/mo at most, Firestore reads from the live inbox).

- **Pure parser** `src/lib/crm2/whatsapp.ts` — `extractWhatsAppMessages` (parses the `messages` envelope: text/media/button/interactive, contact name, phone_number_id) + `extractWhatsAppStatuses` (delivery receipts — Phase 2 applies them). Signature verified with `verifyMetaSignature`/`signMetaPayload` from `meta.ts` (same `X-Hub-Signature-256` scheme).
- **Server** (`server/crm2.ts`, in `registerCrm2Routes`): **`GET|POST /api/webhooks/whatsapp`** (handshake vs `META_WHATSAPP_VERIFY_TOKEN`; signed POST → persist-first to `whatsapp_message_events/{waMessageId}` → ACK fast → async `processWaMessage`: `normaliseMobile(from)` → `findLeadByPhone` (matches CRM2 `mobile` OR old-CRM `phone`, most-recent non-deleted) → reuse or mint a minimal CRM 2.0 lead (`source: WHATSAPP`, `priority: WARM`) → append `/leads/{id}/whatsapp/{waMessageId}` + bump `waLastInboundAt`/`waLastMessageAt`/`waLastMessageText`/`waUnread`). **`POST /api/crm2/whatsapp/send`** (perm `crm.leads.write`) → Graph `POST /{phone_number_id}/messages`; **enforces the 24h free-reply window** (409 otherwise — templates are Phase 2). **`POST /api/crm2/whatsapp/:leadId/read`** (clear unread). **`POST /api/crm2/jobs/run-whatsapp-retry`** (scheduler/admin; drains pending/failed). Dead-letters → `whatsapp_message_deadletters` + error-severity `event:"whatsapp_deadletter"` log. Idempotent on `waMessageId` (write-ahead doc + message doc id).
- **New collections:** `whatsapp_message_events` (+ `whatsapp_message_deadletters`) — server-only write, admin read; `/leads/{id}/whatsapp/{msgId}` — read = lead access OR `hasSocialAccess()` OR `hasCrm2Perm('crm.leads.read')`, **write server-only** (clients never forge messages). New rules helper **`hasSocialAccess()`**; `socialAccess` added to the `/leads` get+list read rule so the inbox can list conversations. **No new composite/CG index** (inbox = `leads orderBy waLastMessageAt desc` single-field; thread = subcollection `orderBy at` single-field — both auto-indexed at collection scope).
- **Module plumbing:** `src/config/navigation.ts` (ModuleKey `+social`, `MODULES`+`MODULE_ACCENTS` `#14B8A6` teal, `MODULE_GROUP_ORDER.social`, `NAV_NODES` `social.inbox`, `buildNavCtx.socialAccess`, predicate `social`); `src/components/layout/SocialShell.tsx` (NEW — copies MisShell; gate = `role==='admin' || socialAccess`); `src/router.tsx` (`/social` shell + `/social/inbox[/:leadId]` lazy); `AppsMenu.tsx` (6th entry + `currentModule` widened to include `'social'`); launcher auto-renders from `MODULES`. `useUiPrefs.DEFAULT_OPEN_GROUPS.social`.
- **UI** `src/features/social/InboxPage.tsx` (NEW) — two-pane inbox (conversation list `orderBy waLastMessageAt desc` + live thread + composer with the 24h-window guard), live via `onSnapshot`; exports a reusable **`WhatsAppThread`** component (for the deferred lead-detail tab). Mark-read on open.
- **Types:** `Crm2LeadSource += 'WHATSAPP'`; `WhatsAppMessage` interface + lead `waLastInboundAt`/`waLastMessageAt`/`waLastMessageText`/`waUnread` (`types/crm2.ts`); `UserProfile.socialAccess?` (`types/index.ts`).
- **Env (Cloud Run, when wired):** `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` (read at runtime; endpoints 403/503 until set — like the Meta leadgen webhook). NOT added to `validateServerEnv` (optional feature; must not block boot).
- **TO GO LIVE (HUMAN + maintainer):** (1) Meta-side: add the **WhatsApp** product to the app (reuse `1329929825237970` or new) → create a **WABA** → register the company number **9247519004** (decide **Coexistence** — keep the WhatsApp Business app — vs API-only) → subscribe the **`messages`** webhook (callback `https://pulse.finvastra.com/api/webhooks/whatsapp`) → long-lived **access token** + **phone_number_id**; Business Verification + display-name approval; **WhatsApp messaging needs its own App Review for production** (same dev-mode gate as leads). (2) Deploy: `deploy:rules` → `gcloud run deploy pulse-api --no-cpu-throttling` (sets the 4 `META_WHATSAPP_*` vars) → `npm run deploy` → `verify:deploy` → register Cloud Scheduler **`crm2-whatsapp-retry`** (`*/15` → `/api/crm2/jobs/run-whatsapp-retry`, OIDC). (3) Grant **`socialAccess`** to inbox agents (Permission Manager — needs a toggle; admins already have it). (4) Live smoke: WhatsApp the business number → lands in `/social/inbox` linked to the lead → reply within 24h.
- **Deferred fast-follows (NOT built):** the WhatsApp tab on the lead-detail page (the `WhatsAppThread` component is ready to drop in — needs the CRM2-lead-drawer vs old-CRM-`LeadDetailPage` surface decided); approved **templates** (proactive / outside-24h) + **media** send (Storage) + delivery-receipt ticks (`extractWhatsAppStatuses` parsed but not applied — would need a `whatsapp.waMessageId` CG index); agent assignment, broadcast; **emulator integration gate** (mirror `.qa/crm2-meta-gate.mjs`); a `socialAccess` toggle in Permission Manager + stamping it into custom claims (currently rules read the user doc). Phases 3-5 (FB/IG Messenger, comments, content) per the plan.

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

#### HRMS dark-mode fix — `var(--text-primary)` used as a BACKGROUND (2026-06-25) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
The recurring "dark/light still bad" reports (latest: Attendance admin filter chips — unselected chips cream-on-cream, invisible in dark) traced to **two systemic antipatterns**, both presentation-only:
1. **`backgroundColor: 'var(--text-primary)'` used as a button/header/selected-chip surface** — `--text-primary` is `#1a1a1a` in light but **`#f0ece0` (cream) in dark** (glass.css:58 vs 442), so these were cream buttons with white text = invisible in dark. Swept **18 HRMS files** replacing it with the brand navy **`#0B1538`** (the intended dark-button look; works in BOTH themes): dataimport, employees, ImportEmployees, helpdesk×2, holidays, itdeclaration×2, TeamCalendar, letters, payslips, performance×2, probation, recruitment, salary, training×2.
2. **Fixed cream `#F2EFE7` / near-white `#FAFAF7`/`#F8F9FA` surfaces paired with `var(--text-*)` text** (filter chips, toggles, tinted preview boxes, stat cards, table striping) — invisible in dark. Fixed: unselected chips → `var(--shell-hover-hard)` + `var(--text-secondary)`, selected → fixed `#0B1538`+white; tinted boxes → `var(--glass-panel-bg)`+border; Holidays row striping → `transparent`/`var(--shell-hover-soft)`; AdminItDeclarations "Total" stat → fixed grey pastel pair. Files: AdminAttendancePage (the reported one), EmployeeDirectory, TeamCalendar, Documents, AdminDocuments, HrLetterGenerator, ApplyLeave, Probation, Performance, AdminItDeclarations, Holidays.
**Rule reinforced (theme rule #2):** **never use a `var(--text-*)` token as a `backgroundColor`** (it inverts per theme), and **never pair a fixed light bg with `var(--text-*)` text**. A dark button = fixed `#0B1538` + fixed white/gold; an unselected chip = `var(--shell-hover-hard)` + `var(--text-secondary)`. tsc + build clean; no logic/server/rules change.

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

### Import preserves EVERY sheet column → shown on the customer (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00083-f8l` + hosting, verify:deploy 3/3)
The importer only kept ~9 mapped fields and **discarded every other column** — so context columns (e.g. "Disbursed Amount", city, branch) vanished, and a `dealSize` with no matched product was lost entirely. Now **all extra columns are preserved** as `importExtras` and shown on the customer for telecallers/managers.
- **`extractCells(raw, mapping, headers?)`** builds **`importExtras: Record<header,value>`** = every column with a non-empty header+value, EXCLUDING the columns mapped to displayName/phone/email/**panRaw**(never leak PAN)/address/notes. So dealSize/product/priority + ALL unmapped columns survive (cap 40 keys, value ≤500 chars). `writeImportedLead` stores it on the lead; `processImportBatch` gained a `headers` param (passed the sheet header row); retry path carries it too.
- **`Lead.importExtras?: Record<string,string>`** (additive). **`LeadDetailPage`** renders a **"Details from import"** card (key→value grid) — visible to whoever can view the customer (owner/telecaller/manager/admin); no rule change (it's just more lead fields, Admin-SDK-written).
- **Backfill for already-imported batches**: **`POST /api/import/backfill-extras {batchId}`** (admin/manager/`crmCanImport`) re-reads the batch's source sheet, rebuilds extras per row, and stamps them onto existing leads (matched by `importHash`, idempotent, no new leads/dupes). UI: a **"Backfill details"** button per row in **Import History** (`useImportJobs.backfillImportExtras`). _Re-importing can't fix old batches (dedup skips them), so this button is the way._
tsc + build clean; no rules/index change.

### Persistent callback reminders — 15 min before, dismiss-only (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00084-26n` + hosting, deploy:indexes + verify:deploy 3/3)
A can't-miss in-app reminder per customer that appears **~15 min before** the scheduled callback and **stays until the telecaller closes it with the ×**.
- **`useCallbackReminders(uid)`** (`src/features/crm/hooks/`): live `onSnapshot` on `leads where primaryOwnerId == uid && leadStatus == 'callback'` (tight scope — only callback leads fetched, not the whole book), filters to `callbackAt <= now + 15min` (upcoming-within-15 OR overdue), excludes dismissed, re-evaluates every 30 s. Dismissal stored per **lead+callback-time** in `localStorage` (`cb_dismissed_{id}_{ms}`) → a card stays gone once ×'d, but a NEW/changed callback time shows again.
- **`CallbackReminderDock`** (`src/features/crm/components/`): fixed top-right stack of cards (gold accent → red when overdue), each = "Callback in N min / overdue by N min" + customer + `PhoneLink`/`ContactActions` (Call/WhatsApp) + "Open customer" + an **× dismiss**. Mounted once in **`CrmShell`** so it follows the user across every CRM page (top-16 right, clears the mobile bottom bar). Shows ≤5 cards + a "+N more" line.
- **Server job shifted 15 min earlier**: `run-callback-reminders` now fires when `callbackAt <= now + 15min` (was `<= now`) and reworded ("Callback soon … in about 15 minutes") — so the bell + email backup also arrive ~15 min ahead. `callbackReminderSent` dedup unchanged.
- **Index**: new `leads(primaryOwnerId, leadStatus)` composite (READY). No rules change (owner already reads own leads). tsc + build clean.

### Partner Intake, Scoring & Onboarding — funnel ON the Connector entity (2026-07-13) — ✅ DEPLOYED (rules ruleset `c91e0c57` + Cloud Run rev `pulse-api-00094-qfr` + hosting, verify:deploy 3/3)
Website/WhatsApp requests to "become a partner and use our DSA code" now have a pre-active funnel + deterministic Hot/Warm/Cold scoring + onboarding checklist — added AS FIELDS on the existing `/connectors` (CON-###) entity. **No new collection, no convert step** — a candidate is a Connector doc from first inquiry. Spec §0–§8 (Rahul). Access = **super-admins only** (extends Masters → Connectors). No AI (pure arithmetic vs an admin-editable rubric). Plan `~/.claude/plans/melodic-roaming-sloth.md`; runbook `docs/go-live/PARTNER-INTAKE.md`.
- **Types** (`src/types/index.ts`): `Connector` gains `funnelStatus` (`Inquiry|Screening|KYC Collection|Agreement Sent|Agreement Signed|Training|Active|Rejected|On Hold`), the screening fields (network type/size, product fit, track record, volume, KYC readiness, DSA-conflict, owner, nextAction, …), server-computed `partnerScoring` (per-factor scores + tier + rubricVersion), and `onboardingChecklist` (7 milestones + `progressPct`). Reuses existing `gstin` (dropped spec's `gstNumber`); the binary `status` stays the picker gate. New `PartnerScoringConfig`.
- **Pure lib** `src/lib/crm2/partnerScoring.ts` (`computePartnerScore`/`computeOnboardingProgress`/`sanitizePartnerRubric`/`DEFAULT_PARTNER_RUBRIC`) — server+client shared, **11 unit tests** (`vitest`).
- **Server** (`server/crm2.ts`): `connectorMainFields`/POST/PATCH extended — **PAN now OPTIONAL on create** (minimal Inquiry = name+mobile+source); recompute `partnerScoring` on any scored-field change + `progressPct` on any checklist change (NEVER read from the body); **derive `status` from `funnelStatus`** (Active→active else inactive; legacy connectors without funnelStatus untouched); stamp `onboardingCompleteDate` at 100%. New **`GET/PATCH /api/crm2/partner-scoring-config`** (auto-seeds default; PATCH bumps version + batch-recomputes NON-terminal candidates, skips Active/Rejected). New public **`POST /api/public/partner-inquiry`** (honeypot + per-IP rate-limit; Inquiry-stage inactive scored connector).
- **Rules**: new `partnerScoringConfig/{id}` read=signed-in-CRM, **write=false** (server-only). Connector block unchanged (update admin/HR; server is the field/recompute guard — comment added).
- **UI** (`src/features/crm2/masters/MastersPage.tsx`, super-admin): Connectors list gains **Tier + Stage columns + tier/funnel filters**; `ConnectorFormModal` is now **tabbed Details/Screening/Onboarding** with a Stage selector — Screening shows a **live read-only score breakdown** (per-factor points + tier, never a black box), Onboarding a checklist + progress bar; PAN optional; manual Status dropdown removed (derived from Stage). New **"Partner Scoring"** Masters tab edits weights/thresholds/penalty → Save recomputes non-terminal candidates.
- **Gate** `.qa/partner-gate.mjs` (`npm run qa:partner`) **12/12**: PAN-less Inquiry create · screening re-tier · forged partnerScoring ignored · Active→status active · onboarding 100%+completion date · config recompute (Active untouched) · public intake + honeypot.
- **Website wiring (P6, human step)**: point the finvastra.com "become a partner" form at `POST /api/public/partner-inquiry` with the existing `X-Finvastra-Webhook-Secret` (no new env var). See `docs/go-live/PARTNER-INTAKE.md`.
- **Graduate Connector → Sub DSA (2026-07-14, rev `pulse-api-00101-vb2`, verify 3/3):** the "start assisted, become independent" path (Rahul's Kiran/MSME case — classify by who does the work TODAY; graduate when they prove independence via the practical assessment). New **`POST /api/crm2/connectors/:id/graduate-to-subdsa`** (crm.masters.write, 409 if already graduated): ONE transaction mints `SDSA-###` carrying name/contact/**KYC (panEnc/panLast4)**/gstin/**payoutBank**/tdsPct + `graduatedFromConnectorId`, `relationshipOwner` = connector.owner (FAPL) else caller; retires the connector (`status: inactive` + **`graduatedToSubDsaId`** marker + activity entry — record KEPT, past `connector_payouts` stay on the ledger); `payoutSlabs` start empty (higher share negotiated fresh); audit-logged. UI: Connectors rows gain **"↗ Graduate to Sub DSA"** (active, non-graduated) with confirm; Stage cell shows **"Graduated → SDSA-xxx"** (purple). `Connector.graduatedToSubDsaId?` type. Gate 26→**30/30**; `run-partner-gate.sh` now exports a TEST-ONLY `PAN_ENCRYPTION_KEY` so encryption paths are exercised in the emulator (prod key unchanged on Cloud Run).
- **Payouts tab — closes the onboarding loop (2026-07-14, rev `pulse-api-00100-z4v`, verify 3/3):** the 2026-06-19 deletion of the HRMS ConnectorsPage had left NO UI for `Connector.payoutRules` or marking `connector_payouts` paid — an Active partner's cases produced no auto-payout. Fixed: connector PATCH/POST now accept **`payoutRules`** (per-rule `sanitizeChannelPartnerRule`, cap 20, junk dropped); the partner modal gains a **`6 · Payouts` tab** (edit mode) with the per-product rules editor (product picker incl. 'All products' fallback · basis flat/%-of-disbursed/%-of-Finvastra-payout · value; instant save) + the payout LEDGER (pending/paid `connector_payouts` via `useConnectorPayouts`, **Mark paid** with UTR via `markConnectorPayoutPaid`). Gate 24→**26/26** (payoutRules sanitized+persisted).
- **UI symmetry polish (2026-07-14, hosting-only, verify 3/3):** generic `MasterTab` gained `noun`/`singular` props (acronym-safe copy — "Search Sub DSAs…", "Add Sub DSA", "No Sub DSAs yet" instead of lowercase "sub dsas") + an `intro` slot rendering the definition line BETWEEN the toolbar and table (matching the Connectors tab rhythm; the floating note above the toolbar removed); generic status badges now title-case (`Active/Inactive/Blacklisted`) across ALL master tabs.
- **TERMINOLOGY SEGREGATION — Connector vs Sub DSA (2026-07-14, hosting-only, verify 3/3) — supersedes the 2026-06-19 "everything is Connector" rename for the SDSA tier.** Rahul's industry definitions locked in: **Connector** = gives us the file, WE do the legwork, they get a small share paid from our payout (`/connectors` CON- ✓ unchanged — the partner-intake funnel lives here). **Sub DSA** = works cases THEMSELVES and only uses the code, gets the HIGH share deducted from Finvastra's gross (`subDsas` SDSA- — name RESTORED). Finvastra itself is a Sub DSA of the Aggregators. Label-only changes (zero money-logic): PayoutTab step 9 "Connector paid"→**"Sub DSA paid"**; `labels.ts` SUBDSA_PAID→"Sub DSA paid"; Dashboards "Connector scorecard"→**"Sub DSA scorecard"**; payout-board caption; lead drawer "Referred by (Connector)"→**"Referred by (Sub DSA)"** (×2); PARTNER_DSA convert "Convert to Connector"→**"Convert to Sub DSA"** with an explainer distinguishing the two paths (refer-files → "Move to Partner funnel"/Connector · work-own-cases → Convert to Sub DSA); promote-row copy states the rule. **Masters "Sub DSAs" tab RESTORED** (generic MasterTab over the existing `subDsas` registry/sanitizer — name/type/mobile/email/city/state/relationshipOwner/gstin/tdsPct/status) with a definition note; the "How it fits together" strip now spells out Connector vs Sub DSA vs Aggregator. Note: `DisburseLoginDialog` already had "Sub-DSA payout % (override)" ✓ and "Connector payout — {name}" (the CON- leg) ✓ — the two payout legs now carry distinct, correct names.
- **FLOW REVERSAL — lead-first, mint-on-qualify (2026-07-14, rev `pulse-api-00099-q27`, verify 3/3) — SUPERSEDES the auto-mint behavior above.** Rahul: CON- codes were being wasted on unvetted potentials; initial screening must happen on the LEADS page. New chain: **partner inquiries land as PARTNER_DSA LEADS** (auto-detect now only STAMPS `category: PARTNER_DSA` + an activity note — no connector created; `/api/public/partner-inquiry` also creates a LEAD now) → **initial calls/screening on the Leads page** like any contact → qualified? → **"Move to Partner funnel"** (the existing promote endpoint) is THE moment the CON- code is minted + the candidate lands in Masters for assessment/onboarding. New **`POST /api/crm2/connectors/:id/return-to-lead`** (crm.masters.write; refuses legacy + Active): re-opens the linked lead (or recreates one), **HARD-DELETES the candidate doc** (Admin SDK bypasses delete:false) so the code is FREED (minter = max+1 over remaining docs); audit-logged. UI: Connectors rows gain **"↩ Return to Leads"** (pre-Active candidates); Masters flow note + lead-drawer promote copy updated. **Cleanup executed on prod**: all 11 Inquiry potentials returned to Leads (re-opened as PARTNER_DSA/NEW, codes freed) — roster is now CON-001 (Binay, legacy) only; next code CON-002. Gate rewritten 21→**24/24** (stamp-not-mint, partner-inquiry→lead, return-to-lead round-trip + Active guard). SA notifications now fire only on the actual move to Connectors (unchanged) — not on form fills.
- **Cosmetic (2026-07-14, hosting-only):** Connectors list STATUS column label capitalized (`active/inactive` → `Active/Inactive`); the stored `status` value is unchanged.
- **Activity log + follow-up system (2026-07-14, rev `pulse-api-00098-h8w`, verify 3/3)** — Rahul: log calls/WhatsApp/email/notes on a candidate + schedule follow-ups ("they requested a follow-up"). Mirrors the CRM 2.0 lead pattern, ON the connector: **(1)** connector PATCH accepts `activity {action, note}` → `activityLog` arrayUnion (at/by/action/note) and `nextFollowUpAt`/`nextFollowUpNote` (setting/changing the time **re-arms `followUpReminderSent:false`**); **(2)** the existing 15-min sweep `run-crm2-followup-reminders` (server.ts) gained a **partner-candidate pass** — connectors with a due follow-up (non-terminal funnel stages, not deleted) → bell (`partner_candidate`) + branded email to every super admin, then reminder marked sent (response gains `partnerChecked/partnerNotified`); **(3) UI** — the connector modal gains a **`5 · Activity` tab** (edit mode; 🔔 when follow-up due): follow-up scheduler (datetime + why, instant PATCH), quick-log bar (📞/💬/✉️/📝 pills + note, Enter or Log = instant PATCH), newest-first timeline; the Connectors LIST gains a **Follow-up column** (gold upcoming / red **DUE**, note on hover). `Connector` type += `activityLog/nextFollowUpAt/nextFollowUpNote/followUpReminderSent`. Gate 19→**21/21**. No rules/index change (single-equality sweep query, server-only writes).
- **Detector fix-up + SA notifications + backfill (2026-07-14, rev `pulse-api-00097-78p`, verify 3/3)** — live-data inspection showed the finvastra.com **/partner page sends real markers** (`sourceMeta.formId` ∈ individual-dsa/corporate-dsa/institutional/co-sourcing/other + `sourceUrl` containing `/partner`) — new submissions since rev 00095 auto-route correctly (verified: Keerthana LD-00040→CON-002, Kiran LD-00041→CON-003); the "General" partner leads all PREDATED the fix. Done: **(1)** `isPartnerIntent` widened with the observed form ids (works even if sourceUrl is ever absent); **(2)** **super-admin notifications** — `createPartnerCandidate` now bells + emails every super admin (`resolveSuperAdminUids` env∪flag; type `partner_candidate` 🤝; link → Masters) on EVERY new candidate (public form, auto-route, manual promote); togglable via new notification-settings key **`partner_candidates`** (client registry + both NotificationType unions + bell TYPE_META updated); **(3)** **backfill executed on prod** — the 8 stuck pre-fix partner leads promoted via the production endpoint (CON-005…CON-012; junk-duplicates + the one genuine general lead skipped, mobile-deduped). Roster after: 12 connectors = 1 legacy active + 11 Inquiry candidates. Gate re-run 19/19.
- **Assessment chain (2026-07-13, rev `pulse-api-00096-ndf`, verify 3/3)** — Rahul: the whole gauge→assess→onboard chain must live in ONE place, no side sheet. Three additions: **(1) the Screening tab IS the call script** — each of the 9 screening fields now carries the exact question to ask (italic "Ask: …" lines, numbered order), so anyone can run the call from the tab. **(2) NEW Stage-2 "Practical Assessment"** (`Connector.practicalAssessment`, tab 3 of the modal): 4 fixed-choice ratings (product knowledge · sample case quality · responsiveness · process understanding, each with its own prompt) + assessor notes; scores/`result` (**Pass/Fail/Pending** — Pending until ALL four rated, so an unrated candidate can never slip through) are server-computed (`computePracticalAssessment` in the pure lib, +5 unit tests → 16; rubric weights + `passThreshold` in `partnerScoringConfig.practical`, editable in the Partner Scoring tab). **(3) ACTIVATION GATE (server-enforced)** — `funnelStatus→Active` now 422s with a human list of what's missing unless: practical assessment = Pass **+** agreement signed **+** PAN collected (`activationBlockers` in server/crm2.ts). **Legacy bypass**: connectors already Active (or active pre-funnel) are never re-gated by ordinary edits. Modal tabs renumbered `1·Details / 2·Screening / 3·Assessment(✓|✗) / 4·Onboarding·N%` so the chain reads left-to-right. Gate 16→**19/19** (Active blocked pre-assessment · FAILED still blocks · Pass+sign+PAN unlocks).
- **Lead-bridge follow-up (2026-07-13, rev `pulse-api-00095-j5h`, verify 3/3)** — partner requests were arriving as GENERAL leads via `/api/public/leads` (the site posts everything there). Three additions: **(1) auto-detect at the website intake** — `isPartnerIntent(category, formId, sourceUrl)` (category PARTNER_DSA, or the form/page names itself partner/dsa-code/become-a-agent) → the submission ALSO creates an Inquiry candidate via the shared `createPartnerCandidate()` and the lead is closed `CONVERTED` + `linkedConnectorId` + category PARTNER_DSA (best-effort; failure leaves the lead open for manual promote); **(2) NEW `POST /api/crm2/leads/:id/promote-partner`** (perm `crm.leads.write`, 409 if converted/already linked) — one click pushes a gauged lead into the funnel, details auto-picked (name/mobile/email/source-mapped leadSource/productInterest), lead closed+linked+activity-logged; **(3) UI**: the lead drawer shows a **"Move to Partner funnel"** row (gold-emphasised when category PARTNER_DSA) and the converted banner names the funnel link. `Crm2LeadFields.linkedConnectorId?` added. **Activation stays super-admin-only** (Masters → Connectors). Gate extended 12→**16/16** (auto-route closes+links the lead; GENERAL promote; promote idempotency 409).

### Attendance-correction flow fix — rules-blocked admin save + deep-link + editor times (2026-07-03) — ✅ DEPLOYED (rules + hosting, verify:deploy 3/3)
Rahul reviewed Kumar's correction request and the flow failed at every step. Four fixes:
- **ROOT CAUSE (rules bug):** the `/attendance` **create** rule only allowed self-creates (`incoming().userId == request.auth.uid`) — an ADMIN marking someone ELSE present on a no-record day was **silently rules-denied**. Create now allows `isAdmin() || isHrmsManager()` (same field/date validation). `deploy:rules` shipped.
- **Silent failure surfaced:** the Daily-view inline `EditRow` had try/finally only — a denied write showed nothing. Now catches + shows an inline error.
- **Editor gained In/Out time fields:** `adminMarkAttendance` accepts optional `checkInTime`/`checkOutTime` ("HH:mm" → fixed-IST instants via new `istInstant`, overnight rolls +24h, computes `workingHours`) so an admin can mark present WITH times from the Daily view. Editor row now spans the full table width (was crammed into 2 columns) and inputs use the opaque `--ss-bg` (theme rule — the translucent panels were unreadable).
- **Deep-link to the request:** `AdminAttendancePage` reads `?tab=` (corrections/month/geofence); the correction NOTIFICATION link + the Approvals-inbox corrections route now point at `/hrms/admin/attendance?tab=corrections` — the reviewer lands ON the pending request (Approve applies the requested times + marks present), instead of the Daily view.

### HRMS simplification — Approvals inbox · My Requests · header sweep (2026-07-03) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
The CRM simplification pattern applied to HRMS (inventory first: 41 admin sidebar items, approvals scattered across NINE pages, employees had NO consolidated request-status view, only 1/37 pages on the shared primitives, plus real bugs). **No server/rules/index change.**
- **Approvals inbox — NEW `/hrms/admin/approvals`** (`src/features/hrms/approvals/ApprovalsPage.tsx`, nav node `hrms.approvals`, own single-item "Approvals" group right under Dashboard, access hrmsAdmin): ONE radar for everything waiting on HR across all 9 types — leave applications · encashment · claims · attendance corrections · IT declarations (submitted) · access requests · helpdesk (open/in_review) · probation decisions (on_probation/extended) · performance reviews (self/manager_review, current cycle year). Config-driven sections (`SECTIONS`), each: live count + oldest-5 items (name/detail/date; names resolved via useAllEmployees where docs lack employeeName) + "Review →" into the existing page (which keeps its full context — balances, bills, tabs). Sections with 0 pending are omitted; all-clear state when nothing anywhere. Read-only radar — never mutates.
- **Shell badge for the inbox** (`HrmsShell.tsx`): new red item badge on `/hrms/admin/approvals` = SUM across all 9 types — including **pending leave applications + pending claims, which previously had NO badge anywhere** (new generic `usePendingDocCount(col,status,enabled)` hook fills those two). Bug fixes in the same file: the two ORPHANED section-badge keys `'Payroll & Finance'`/`'Statutory'` (groups that no longer exist — their counts never rendered) remapped/merged into `'Payroll & Compliance'`; the **dead hand-rolled nav constants deleted** (`NAV`/`ADMIN_NAV_GROUPS`/`LIFECYCLE_NAV`/`COMPLIANCE_NAV` + `NavEntry` — ModuleSidebar superseded them). Dashboard's `HrPendingActionsPanel` gained an "Open Approvals inbox →" link.
- **Employee dashboard upgrades** (`HrmsDashboardPage.tsx`): NEW **`MyRequestsCard`** — one place an employee sees the status of EVERYTHING they've asked for (pending leave / claims / attendance corrections / encashment, own-uid live queries, hidden when nothing pending; previously spread over 4 pages). The Attendance StatCard now shows **today's clock state** ("Today: clocked in 9:42 am" / "not clocked in yet" amber / "done for the day ✓") via `useTodayAttendance`, not just the month aggregate. Bug fix: the Headcount card navigated to the dead `/hrms/admin/employees` route → `/hrms/employees`.
- **Header sweep — 41 HRMS pages converted** to the shared `PageHeader` (title · plain-language subtitle · same-row controls into `actions` · pinKey where a nav node exists — all keys verified against NAV_NODES): every self-service page (Attendance/Leave/ApplyLeave/Claims/Payslips/Documents/Announcements/Directory/OrgChart/ITDecl/Performance/Training/Helpdesk/Settings/Holidays/TeamCalendar) + every admin page (AdminLeave/AdminClaims/ClaimsAnalytics/AdminAttendance/GeneratePayslip/AdminDocuments/AdminAnnouncements/AdminItDecl/CompOff/YearEnd/Letters/PFTracker/Compliance/Assets/AdminPerformance/AdminHelpdesk/AdminTraining/SalaryHistory/Employees/Recruitment/Onboarding/Offboarding/AccessRequests/ImportEmployees/Probation). The three competing header styles (Fraunces-italic ×27, Fraunces-bold ×6, plain-sans ×3) are gone. Skipped deliberately: EmployeeProfilePage (identity banner with photo-upload affordance — not a page header). Group order fix: Communications now renders before Performance (matching the registry).
- Files: `approvals/ApprovalsPage.tsx` (new), `HrmsShell.tsx`, `HrmsDashboardPage.tsx`, `navigation.ts` (+`hrms.approvals`, group order), `router.tsx`, + 41 header conversions across `src/features/hrms/**`.

### CRM simplification — role-based Home · Performance hub · sidebar diet · header sweep (2026-07-03) — ✅ DEPLOYED (hosting-only ×2, verify:deploy 3/3 each)
Rahul: the tool works but is "messed and difficult to browse" — wants "perfect looking, simple, no heavy learning". Approved decisions: CRM first · consolidate+redirect · role-based Home. Plan `~/.claude/plans/melodic-roaming-sloth.md`. **No server/rules/index change** (reuses the cached activity/team/imports endpoints). Two hosting-only phases, both live.
- **Role-based Home at `/crm/dashboard`** (path unchanged → nav/tour/share keys intact). NEW `src/features/crm/home/`: `CrmHomePage` (calls NO data hooks; mounts exactly ONE persona child — hook-safe, no cross-persona listeners) → **`MyDayHome`** (telecaller: callbacks-due-now / overdue-queue / calls-today / untouched StatCards, top-3 "Next up" + Get-next-lead, month-target bar, quick links), **`TeamPulseHome`** (manager: own-numbers strip, **Needs attention** person-rows with spelled-out reasons [callbacks due / past SLA / ≥10 untouched / inactive ≥3d], team due-actions cap 8, import verdict chips working/mixed/cold, go-deeper), **`BusinessPulseHome`** (admin: pipeline KPI strip + disbursed MTD, 3 BizLineCards, all-team mini-cards → hub deep-links, data verdicts, SourceBreakdown + CommissionDashboardCard, collapsed `<details>` SeedTools). Salvage: `home/widgets.tsx` (fmtRupees/SOURCE_LABELS/useOpenOppsStats/BizLineCard/SourceBreakdown) + `home/SeedTools.tsx` (CrmSetupPanel + dev DevAdminTools, verbatim). **`CrmDashboardPage.tsx` DELETED** (RmPerformanceTable dropped — redundant with the hub).
- **Performance hub `/crm/performance`** (`src/features/crm/performance/PerformanceHubPage.tsx`) — query-param tabs `?tab=me|team|data|aging` (visibility: me=all · team/aging=manager+admin · data=+crmCanImport; omitted not disabled). Reuses existing pages as tab bodies via a new **`embedded` prop**: `MyActivityPage` (also gained `?view=untouched` deep-link into the untouched tab), `TeamPerformancePage` (+`initialViewUid` seeded ONCE from `?uid=`, remount-keyed), `LeadAgingPage`, and `ImportPerformanceSection` (now exported from ImportHistoryPage). **Old routes are redirects** via a `LegacyTab` helper in `router.tsx` that preserves the incoming query: `/crm/my-activity`→`?tab=me`, `/crm/team`→`?tab=team`, `/crm/reports/aging`→`?tab=aging`. `shareablePages.ts` `crm.lead-aging` route repointed to `/crm/performance?tab=aging` (query-route matching); tour anchor `crm-team` remapped to the `crm.performance` node + step copy updated (tourSteps.ts).
- **Sidebar diet** (`navigation.ts` + `useUiPrefs.ts`): CRM groups `Dashboard/Workspace/Customers/Pipeline/Teams/Admin` → **`Home/Work/Pipeline/Manage/Admin`** (Admin collapsed). Nodes: Home group = Home (relabelled from Overview) + **Performance** (new) + Analytics(admin); Work = Tasks/Customers/Targets; Manage = Import/Import Queue/Import History; `crm.myActivity`/`crm.team`/`crm.reports` nodes REMOVED (stale pins drop silently — by design). Counts: telecaller **5** · manager **8** · admin **12 core** + 9 tucked. `useUiPrefs.openGroups` now falls back to defaults when a saved section list contains ZERO current group names (pre-rename localStorage would otherwise render everything collapsed).
- **Header sweep (Phase 2)** — converted the bespoke Fraunces-h2 headers to the shared `PageHeader` (title · plain-language subtitle · controls in `actions` · pinKey): DashboardsPage(Analytics), CommandCentrePage (greeting kept as title), TargetsPage, TasksPage (its tab pills stay as content), ImportHistoryPage (History⇄Performance toggle moved into actions); Crm2LeadsPage/Crm2CasesPage/LeadsPage got the `h-display` title treatment inline (their action rows are interleaved). Crm2 list titles simplified: "Pipeline Leads"→"Leads", "Pipeline Cases"→"Cases". TeamPerformancePage/LeadAgingPage standalone headers left (unreachable — routes redirect; they render embedded).
- **Mobile tabs** (`CrmShell.tsx`): full-CRM bar is now **Home · Tasks · Customers · (Performance | Cases)** + Menu — Cases only for plain case-workers (`crm.cases.read` && !manager && !admin), fixing the old mismatch where the Cases tab showed for users whose sidebar hides Cases. Referral-only 2-tab bar untouched.
- Release notes: users who had pinned My Activity / My Team lose those pins (repin Performance); old bookmarks/deep links all redirect.
- **Customers page follow-up (same day, Rahul's review):** the "Legacy" pill + "being phased into Leads" note REMOVED (it's the callers' daily list — the tag read wrong); subtitle now explains the two counts ("N waiting for a call (table below) · M already answered (boards above) · T total"); the **Interested board column removed** (marking Interested promotes the customer into Leads, so the column was permanently 0) — interested-but-NOT-yet-promoted customers (dispositioned by someone without `crm.leads.write`) now stay in the TABLE with a green "Interested — move to Leads" badge (desktop + mobile) so a manager promotes them instead of them vanishing.

### Import performance view · team member removal · perf caching (2026-07-02) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00092-9xz` + hosting, verify:deploy 3/3)
Follow-ups to My Activity, per Rahul: management must judge WHICH import file worked; admins must be able to REMOVE people from a team; and the management pages felt laggy.
- **Import performance** — new **`GET /api/crm/imports/performance`** (admin / CRM manager / crmCanImport): groups ALL non-deleted leads by `importName` (fallback `Batch {importBatchId}`; manual adds = their own bucket) → per-import funnel {leads, unassigned (in queue), attempted+%, untouched, interested (interested+callback), converted, dead (no_response+not_interested+wrong_number) + dead% of attempted, first/last created}. **UI: Import History page gains a History | Performance toggle** (`ImportPerformanceSection` in `ImportHistoryPage.tsx`) — one row per data source with green/amber/red signals; nav `crm.import-history` access widened admin → **manager/crmCanImport** (page data via `useImportHistory(canSee)` — rules already allow since audit Phase 1). **My Activity gains an import filter** — the summary endpoint accepts `?importName=` (scopes counts, statuses, untouched list AND the call log to that import's leads) and always returns `importNames[]` for the dropdown.
- **Remove from team** — `/crm/team` member rows gain a red **UserMinus button (admins only**, matching add-members being admin-only): confirm dialog → clears `reportingManagerUid/Name` on `/users` (client batch via the admin-update rule) → fresh reload. Their customers/data untouched; reassign leads via Manage first if needed.
- **Lag fix** — the management aggregations (team performance / all-teams / import performance) scan whole collections per request; that latency was the "laggy" feel. Added a **45s in-process cache** (`perfCache`/`cachedJson` in `server.ts`, bounded 200 entries) keyed per target+period; **`?fresh=1` bypasses** — sent by the Team page's Refresh button and after add/remove/reassign actions so user-triggered changes always show immediately. Repeat opens are now instant.
- No rules/index change. Files: `server.ts`, `ImportHistoryPage.tsx`, `MyActivityPage.tsx`, `TeamPerformancePage.tsx`, `navigation.ts`.

### Call-activity tracking — tagged → attempted → outcome (My Activity) (2026-07-02) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00091-dw5` + hosting, verify:deploy 3/3)
Rahul's ask: outbound-call visibility BEFORE the business numbers — how many customers each caller was tagged, when the data was given, how many calls made, what statuses were set, and what data was never worked; self-view for every caller, at-a-glance for managers, all-teams for admins. Old-CRM Customers model (`primaryOwnerId` + `/leads/{id}/activities` + `leadStatus` + `firstContactedAt` + `assignedToCurrentOwnerAt`). Deterministic aggregation — no AI; no rules/index change (uses the existing `activities (by, at)` CG index).
- **Server** (`server.ts`): `accumulatePerf` rows gain **`attempted`** (owned leads with `firstContactedAt`) + **`untouched`** (status still `new` AND never contacted — "data given but not worked"). New **`GET /api/crm/activity/summary?period=YYYY-MM[&uid=]`** — self for anyone; a CRM manager may pass any downline uid (verified via `computeDownline`); admin/SA anyone. Returns: tagged / taggedInPeriod (from `assignedToCurrentOwnerAt`) / attempted / disposition mix / `untouched` list (oldest-first, top 100, with importName + tagged time) / `byType` counts + totalTouches + uniqueCustomersTouched / per-IST-day `daily` series / `recent` activity drill-down (≤150, lead-name resolved).
- **UI — new page `/crm/my-activity`** (`src/features/crm/activity/MyActivityPage.tsx`, nav "My Activity" in CRM Workspace, icon PhoneCall, access = any CRM user; pinnable `crm.myActivity`): month picker + (manager/admin only) a "View person…" picker (manager → transitive downline, admin → everyone; server re-enforces); KPI strip (Customers tagged +received-this-month · Calls/touches with call/WA/email/meeting split · Customers attempted % · **Untouched** red card that jumps to the list); "Calls per day" bar chart + status-mix chips/donut; two drill-down tabs — **Call log** (each logged touch: type icon, customer link, note, time) and **Untouched customers** (oldest first, import source, tagged date, open link).
- **Team page** (`/crm/team`): member table gains an **Untouched** column (red when >0) and the **Touches count is now a link** → that member's `/crm/my-activity?uid=` — the manager drills into any rep's call log in one click. (All-teams admin section unchanged; admins reach the same drill-down via the team picker or the page's own person picker.)
- **Where to look (told to Rahul):** telecaller → CRM sidebar → Workspace → **My Activity**; manager → **My Team** table (Touches/Untouched columns, click Touches to drill); admin/SA → same + person picker on My Activity + All-Teams on the team page.

### Full-software audit — Phases 2–6: money hardening · dedup/races · permissions · speed · HR criticals (2026-07-02) — ✅ DEPLOYED (rules ruleset `637a222c` + Cloud Run rev `pulse-api-00090-z8n` + hosting, verify:deploy 3/3)
The rest of the audit backlog, built by 4 parallel agents (strict file ownership) and verified together: tsc + build clean; emulator gates **phase2 31 · phase4 24 · phase4-money 13 · phase5 12 · queue 18** all green.
- **Money pipeline (`server/crm2.ts` + rules):** (1) `resolveMapping` now HARD-FAILS on ambiguity — >1 mapping matching at any tier (after ACTIVE-preference) → 409 naming the duplicate mapping ids (`pickUnambiguousMapping`); covers all 4 disburse/preview call sites. (2) Money inputs validated — new `optMoney` (finite, ≥0) / `optPct` (finite, 0–100, REJECTED not clamped) on disburse (`disbursedAmount`/`processingFee`/`roiPct`/`subDsaPayoutPct`/`channelPartnerPayoutOverride`) + all milestone money fields; `optNum` rejects non-finite. (3) **CLOSED cycles locked** — milestone PATCH 409s once `closedAt`/status CLOSED (recon dispute still works post-close by design). (4) **Multi-login recon completed** — import matching keyed strictly per misRecord id (==loginId); rows gain `matchedMisId`/`matchedLoginId`; import + response gain `missingEntries[{misId,caseId,loginId,loanAccountNo}]` (`missingCaseIds` kept for back-compat); dispute + manual row-match dropped their arbitrary `.limit(1)` caseId fallbacks — multi-cycle case without `loginId` → 409 listing candidates; ReconPage sends `loginId` (+ fixed a latent `r.id`→`r.importId` bug that broke row load after upload). (5) **Rules leak closed** — `bankMisImports/{id}/rows` read now requires `payout.amounts.read` (was `recon.read`; rows carry dump amounts — SDK read bypassed the API's money-stripping); parent import doc stays `recon.read`.
- **Permission tightening (`server/crm2.ts`):** recon import POST + manual row-match PATCH now require new perm key **`recon.write`** (added to `VALID_KEYS`, `CRM2_PERM_KEYS`, the Permissions page "MIS & Recon" group; ReconPage gates upload/unmatch by it — omitted not disabled). Dispute already required `payout.write`. **Share is no longer a GET side-effect** — `GET /api/crm2/mis/business-sheet` is a pure download; new **`POST /api/crm2/mis/business-sheet/share`** (requires `payout.amounts.read` + `payout.write`) stamps dataSharedAt/To/reportingMonth in one batch + audit log + returns the xlsx; MisGridPage Share uses it (button shown only to holders of both). **Telecallers can't self-assign** — `PATCH /api/crm2/leads/:id` changing `assignedRm` now requires manager/admin (403 otherwise; queue claim/release unchanged); the lead drawer's Assign-RM picker is manager-only. **WhatsApp dup mint fixed** — `processWaMessage`'s phone lookup moved INSIDE the minting transaction (`tx.get(query)`), so concurrent first messages can't double-mint; dead `findLeadByPhone` removed. Gate `.qa/crm2-phase4-gate.mjs` updated for the share POST.
- **Dedup + races (`server.ts`):** (1) **Canonical phone** — new `canonicalPhone()` (digits-only; strip leading 91 ONLY when remainder is a valid 10-digit mobile; landlines keep STD zero — stripping would collide with real mobiles). Applied at `writeImportedLead` (phone + de-duped altPhones); `buildImportHash` canonicalizes internally; import dedup + retry query BOTH canonical and legacy raw hashes during transition (`buildImportHashLegacy`/`findExistingImportHashes`); `check-duplicate` queries both forms. New **`POST /api/admin/backfill-phone-normalization`** (admin, idempotent, chunked): rewrites phone/altPhones to canonical, preserves the replaced value once in additive `Lead.phoneOriginal`, recomputes `importHash`; returns `{scanned,changed,skipped,failed}`. **Run once post-deploy.** (2) **Distribute-vs-pull race closed** — `distributeBatch` now claims leads in chunked TRANSACTIONS (16/tx, 4 concurrent) re-checking still-UNASSIGNED in-tx (mirror of `/api/leads/pull`'s claim); opportunity re-owning + activity ride in the same tx; skipped (already-claimed) leads don't count. (3) `distributedCount` + per-agent notifications now reflect leads ACTUALLY assigned.
- **Client speed + polish:** `useMyLeads` N+1 fixed — per-lead opp cache + `docChanges()` (only added/modified leads refetch; version counter guards out-of-order snapshots); returned shape unchanged. New **`src/lib/errors.ts`** `userFacingError()` (passes app-thrown human messages through, replaces SDK dumps, always console.errors detail) applied at 16 MIS call sites (Upload/Statements/Reconciliation/LineMatch/Disputes/GeneratePayouts/PayoutDetail/PayoutSlabs/StatementTemplates); template save/seed/remove now toast success+failure (were fully silent). `GeneratePayoutsPage` hook-rule violation fixed (early `<Navigate>` return sat above hooks — React #310 class). HRMS shell listener audit: all ~21 subscriptions verified narrow/single-doc/one-shot — NO fix needed (the "13 broad listeners" finding was not real).
- **HR criticals (from the deep-dive audit; `src/features/hrms/**`):** (C1) **Encashment now debits EL** — `approveEncashmentRequest` is a transaction on `leave_balances/{uid}_{FY}` + the request: re-reads status (double-approve guard), rejects over-balance with a human message, debits earned.used/remaining + approves atomically; FY keyed from the request's payroll `month` (`encashmentFyOf`). (C2) Submit validates days ≤ earned remaining (inline error); approve enforces a cumulative **30-day/FY cap** across approved+paid requests. (C3) **`approveLeave`/`cancelLeave` key the balance by the LEAVE's FY** (`leaveYearOf(application.fromDate)`), not the click date — March leaves approved in April now debit the right year (matches grantCompOff). (M1) `approveLeave` is now one transaction with an already-processed guard. (H1) ApplyLeavePage partial-balance-doc crash fixed (`?.remaining ?? LEAVE_DEFAULT_TOTALS`). (H2) **Attendance date key is IST** — new `istDateKey()` (epoch+330min) in checkIn + useTodayAttendance (was browser-local; a foreign-TZ device stored the wrong day). (H3) **Duplicate payslips blocked** — `createPayslip` is a transaction on deterministic `payslips/{uid}_{month}` (human error if exists; old random-id payslips stay valid — readers query by fields); Generate All counts skips instead of aborting. (M3) Overnight regularization rolls checkout +24h (was 0 hours). AdminLeavePage toast gained an error variant. Audit leftovers NOT done: dead `src/lib/hooks/{useLeaves,useAttendance}.ts` (delete needs owner OK); regularized-time display in viewer-local TZ (cosmetic).
- **Post-deploy actions:** ① ✅ **phone backfill EXECUTED 2026-07-02** (`POST /api/admin/backfill-phone-normalization` → `{scanned:1526, changed:76, skipped:1450, failed:0}`); ② ⏳ grant **`recon.write`** via CRM Permissions to whoever uploads/matches recon dumps (`recon.read` alone no longer allows mutations); ③ ⏳ non-admin business-sheet sharers now also need `payout.write`. **New/changed:** endpoint `POST /api/crm2/mis/business-sheet/share`; endpoint `POST /api/admin/backfill-phone-normalization`; perm key `recon.write`; `Lead.phoneOriginal` + `altPhones` canonical; file `src/lib/errors.ts`.

### Full-software audit — Phase 1: broken-for-users fixes (2026-07-02) — ✅ DEPLOYED (rules + hosting, verify:deploy 3/3, ruleset `1f0dd86e`)
A 3-agent read-only audit (CRM/leads, CRM 2.0 money pipeline, HRMS/MIS+reliability) found ~35 verified issues. **Phase 1 = the "broken for real users" batch** (no server/Cloud Run change — client + rules only):
- **Transfer-to-specialist was rules-broken for every non-admin** (the exact roles it's for). `firestore.rules` opportunity `update` allowlist now includes **`ownerId`** and a branch for the lead's primary owner + `isManagerOf(ownerId)`, so `transferOpportunity` (generator→convertor handoff) works. Blast radius safe: you can only hand off a deal you own/sourced/manage. (`ownership_change` activity type was already allowed.)
- **Silent bulk actions** (`LeadsPage`): `handleBulkStageUpdate`/`handleBulkAssignRm` now count outcomes and **toast** `moved / failed / skipped` instead of swallowing permission-denials and clearing the selection as if it worked. On failure the selection is kept.
- **Import access mismatches**: `ImportPage.canRun` + `ImportQueuePage` now include **`crmCanImport`** (matched the nav + server, which already allowed it — users saw the menu then an access-denied page). `import_jobs` read rule widened to `isManager() || hasCrmImport()` (new `hasCrmImport()` rules helper) so non-admin distributors see an admin's batches; leads `list` rule now lets managers/crmCanImport list the `primaryOwnerId=='UNASSIGNED'` pool (the queue's live remaining-count query; telecallers still blocked). `ImportQueuePage` fetches `useImportHistory(canRun)` (was admin-only).
- **Dead MIS link**: `UploadStatementPage` post-import "Go to Reconciliation" navigated `/mis/reconciliation/:id` (no such route → catch-all → launcher); now `?statementId=` (which `ReconciliationPage` reads).
- **Silent lead-action failures** (`LeadDetailPage`): `handleDisposition`/`handleReassign`/`handleSaveCallback` gained `catch` + toast (were `try/finally` only — a denied write snapped the UI back with zero feedback). Reassign/callback also toast success.
- **2 micro-fixes**: `AssignLeadModal` now stamps `assignedToCurrentOwnerAt` (schema parity with distribute/pull/bulk → correct "Nd with owner"); `useCallbackReminders` filters `lead.deleted` (soft-deleted/RTBF leads stopped reminding).
- **Remaining audit backlog (Phases 2–6, NOT yet done):** money-pipeline hardening (ambiguous slab-mapping arbitrary pick, unbounded/negative payout %, post-CLOSED cycle edits, multi-login recon keyed by caseId, recon-row money readable via SDK with only `recon.read`), duplicate prevention (phone stored 3 ways → dedup misses; distribute-vs-pull race; WhatsApp dup mint; `distributedCount` counts failed leads), permission tightening (recon mutations gated by read keys, `crm.leads.write` can PATCH any lead + self-assign past the queue), and scale (team endpoint + dashboards scan whole collections; ~13 uncapped shell listeners; `useMyLeads` N+1). tsc + build clean; no index change.

### CRM performance model — own numbers for everyone + coachable team view + All Teams + agent-only teams (2026-07-01) — ✅ DEPLOYED (rev `pulse-api-00089-grc` + hosting, verify:deploy 3/3)
Everyone in CRM generates business (managers + super-admins included), so the team page (`/crm/team`) was rebuilt as **"My Performance & Team"**, with a hierarchy guardrail Rahul flagged as a bug.
- **Model/invariant:** Elevated = `role==='admin'` || `crmRole==='manager'` || super-admin. **A manager's team may only contain plain AGENTS** — an elevated person must never sit inside (Hemadri must never see Ajay's numbers). Enforced in 3 layers: (1) **metrics** — `computeTeamSummary` filters elevated users out of the downline (`isElevatedUser` in `server.ts`), so even bad data can't leak; (2) **pickers** — `AddTeamMembersModal` + the Employees edit-modal Reporting-Manager picker exclude the bad combinations; (3) **server** — `/api/admin/employees/create` 400s when an elevated person is assigned under a `crmRole:manager`. _Live data scanned 2026-07-01: clean (no elevated person under a manager); Hemadri's team = 5 agents._
- **Server** (`server.ts`): `accumulatePerf(people, period)` extracted (one-pass leads/opps/commission/targets accumulation, shared so views can't drift) + coaching metrics per row — `conversionRate` (converted/leads %), `inactiveDays` (since last lead activity), `callsLogged` (call/whatsapp/email/meeting activities this period via the existing `(by,at)` CG index). `computeTeamSummary(uid, period, includeHead)` now returns `{head, members, totals}` — head = the person's OWN numbers (`isHead:true`), totals = head+team combined; `includeHead` defaults false so `run-weekly-team-digest` is unchanged. `GET /api/crm/team/performance` always returns head+team (everyone gets their own numbers; empty team → own only; admin/SA may pass `?managerUid`). **NEW `GET /api/crm/team/all-teams?period`** (admin/SA): every `crmRole:manager` with own row + agent rows + combined totals + `unassigned` agents — single accumulation pass.
- **UI** (`TeamPerformancePage.tsx`): Section 1 **"My performance"** (head KPI strip: leads/pipeline/disbursed-vs-target/commission/conversion/activity+touches) · Section 2 **team table** with new Conv%/Touches/**Flag** columns — deterministic `coachFlag`: ⭐ Appreciate (achievement ≥80% | top disbursals | conv ≥25% w/ ≥10 leads) / ⚠ Attention (SLA overdue | inactive ≥7d | achievement <30% w/ target), tooltip states the exact reason · Section 3 **"All teams"** (admin/SA, expandable manager cards + agents-without-a-team). Combined KPI chips read "you + team". Add-members picker offers agents only.
- No rules/index change. Live E2E verified as admin: all-teams returns Hemadri (own 0) + 5 agents (794 leads); own-performance returns the head row with `isHead`.

### "Not eligible" customer disposition (2026-07-15) — ✅ DEPLOYED (rev `pulse-api-00102-lb5` + hosting, verify:deploy 3/3)
New closing status for old-CRM Customers who fail the post-profiling CIBIL/profile check: `LeadStatus` gains **`not_eligible`** ("Not eligible (CIBIL / profile)" in the LeadDetailPage Status dropdown). Treated as TERMINAL everywhere: clears `slaDeadline` on set (LeadDetailPage `TERMINAL_STATUSES`), counted as closed/dead in `accumulatePerf` CLOSED + imports-performance DEAD + all three server status maps (`server.ts`), excluded from SLA sweeps (`src/lib/crm2/sla.ts` `OLD_TERMINAL`), and shown as its own board column on Customers (`LeadsPage` `LEAD_BOARD_COLUMNS`, rose) + a status chip on Team Performance / My Activity (`STATUS_META`/`STATUS_ORDER`). No rules change (leadStatus values aren't rules-validated).

### Dead-import cleanup — 82 unused imports across 31 files (2026-07-15) — commit, NOT deployed
Cleared the VS Code Problems-tab "unused import" hints (incl. the ReconPage.tsx one). Removed **only** unused named + type imports (leftovers from prior refactors — the shells' icon imports were the bulk, previously flagged as "left for a cleanup commit"); `tsc --noEmit` 0 errors + full `npm run build` green (Vite fails on any missing import, so removals are proven safe). **Unused LOCAL variables (~31, incl. dead useState hooks + unused modal-component fns in AdminPerformancePage) were deliberately LEFT** — their initializers can have side effects, so blind removal risks behaviour. Behaviour-neutral, editor-hygiene only → **committed but not deployed** (identical bundle behaviour; `server/crm2.ts` unused-import removal rides the next real server deploy). Files touched span both shells, HRMS/CRM/CRM2 pages + hooks.

### HR Letter Generator — auto-prefill from the employee master (2026-07-15) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Selecting an employee in the HR Letter Generator now prefills EVERY relevant field from the stored employee record — nothing is re-typed per letter, and permanent corrections are made in the employee's profile (single source of truth). `HrLetterGeneratorPage.tsx` previously auto-filled only designation/department/joiningDate (from `/users`); now on employee-select it also fetches **`/user_details/{uid}`** (address, gender) + **`/employee_sensitive/{uid}`** (monthly salary components) via `getDoc` and prefills: **Salutation** (gender Male→Mr. / Female→Ms.), **Residential Address** (presentAddress → permanentAddress fallback, appointment letter), **Annual CTC** (monthly `grossSalary` ×12, offer + appointment), and the **Annexure salary breakdown table** (Basic/HRA/Conveyance/Medical/Other rows from the monthly components). Every field stays editable for one-off overrides; a field is prefilled ONLY when the master has a value (a manual entry is never blanked by missing master data). A gold note under the picker states the data came from the employee record + names any missing piece ("address / salary not on file yet — add it in the employee's profile so it prefills next time"). Reads are admin/HR-only docs the page already reads elsewhere (EmployeeProfilePage) — page is gated admin+isHrmsManager, so no rules/server change. New helper types `EmpDetails`/`EmpSalary`; fetch effect keyed on `[empId, manualMode]`, fill effect on `[empId, letterType, empDetails, empSalary]`.

### Onboarding/Offboarding checklist tick — BUGFIX + direct-tick UX (2026-07-15) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
"Mark Done" on the Onboarding checklist did nothing. **Root cause: `serverTimestamp()` used INSIDE an array element** (`items[].completedAt`) — Firestore forbids `serverTimestamp()` inside arrays, so `updateDoc` threw (no catch) and the item never saved. A second latent bug: the Onboarding detail view rendered from a click-time `selected` snapshot the live listener never refreshed, so even a successful tick wouldn't show. Fixes in `OnboardingPage.tsx`: (1) **direct tick** — clicking a checklist item now toggles it done/undone instantly (removed the `TickItemModal` note/confirm dialog per the user's ask — "direct tick, no box"); (2) array `completedAt` uses **`Timestamp.now()`** (client), top-level `completedAt`/`updatedAt` keep `serverTimestamp()`; (3) parent now tracks the open checklist by **id** and derives it LIVE from the `onSnapshot` array (`checklists.find`), so ticks + the completed roll-up show immediately; per-item `savingId` guard dims the row mid-write. **`OffboardingPage.tsx` had the identical array-timestamp bug** (its checklist ticking was silently broken too) → fixed the one line (`serverTimestamp()`→`Timestamp.now()` inside `items.map`); its detail view already subscribes live (`live` state) so no other change. **Rule reinforced: NEVER put `serverTimestamp()` inside a Firestore array element — use `Timestamp.now()`; `serverTimestamp()` is only valid at top-level doc fields / map values.** Frontend-only; no rules/server/index change.

### To-Do redesign — clean cards + Google-style month calendar + self-add for everyone (2026-07-16) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00104-59s` + hosting, verify:deploy 3/3)
User feedback on the first To-Do cut ("complicated view", self-assigned task showed TWICE, wanted a calendar like Google Workspace). Rebuilt `TasksPage.tsx` `ToDoSection`:
- **Quick-add bar** (top, one line): task text + optional due datetime + (managers only) a "For: Myself/anyone" picker → Enter or Add. **Anyone can now add a task for THEMSELVES** — `POST /api/crm2/tasks` relaxed: self-assign allowed for all; assigning to someone else still requires manager/admin (403 otherwise); **self-assigned tasks skip the bell + email** (no self-notification). The old AssignTaskModal is gone.
- **Clean card layout, deduped**: two-column grid — LEFT "My tasks" (everything assigned to me; a self-created task shows ONCE here, labelled "my task") + "Assigned by me" (`createdBy == me && assignedTo != me` — the dedup fix); RIGHT: lead follow-ups due / new-leads-first-call / customer callbacks as uniform `LinkCard`s. Tick = circle button (hover reveals the green check), overdue cards red-outlined.
- **Calendar view** (List | Calendar toggle): Mon-start month grid (`TasksCalendar`) plotting ALL dated items — **tasks (dueAt, gold) · lead follow-ups (nextFollowUpAt, amber) · customer callbacks (callbackAt, green) · meetings (`useMyMeetings` scheduled, blue)** — as colour dots per day (max 4 + "+N"), today gold-ringed, click a day → detail panel below (time · item · ✓ Done for tasks / Open→ links), ‹ › month nav + Today button + colour legend. No new data reads (meetings reuse the existing hook).
Server change is additive (looser create gate); no rules/index change.

### HRMS lifecycle sync — probation→exit→offboarding as one flow + checklist "Not applicable" (2026-07-20) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Rahul: probation, terminate and offboarding are "all at different places and not in sync"; and the onboarding/offboarding checklists forced every asset item done even when no laptop/phone/SIM was issued. Two coherent fixes:
- **Checklist "Not applicable" outcome** (onboarding + offboarding): `ChecklistItem` gains additive **`outcome?: 'done' | 'not_applicable' | null`** (`completed` still means RESOLVED = done OR N/A, so progress/% and the existing status roll-up are unchanged). **Onboarding** (`OnboardingPage.tsx`): direct-tick `setOutcome(item, outcome)` — circle = Done, a per-item **N/A** button marks not-applicable (e.g. no SIM issued), resolved items show an N/A badge + reset ✕. **Offboarding** (`OffboardingPage.tsx`): the tick modal's buttons are now **Not applicable / Mark Done** (+ Reset to pending); N/A items render a grey circle + N/A badge. So a checklist reaches 100% honestly when an asset never applied. Existing checklists (no `outcome`) render normally. No rules change (admin/HR update already allowed).
- **Probation → exit → offboarding = one flow**: `ProbationPage` active rows gain a red **"Fail & Exit"** action → `navigate('/hrms/employees?exitFor={uid}&exitReason=termination')`. `EmployeesPage` now reads **`?exitFor={uid}`** (waits for the employee list to load, matches by userId) and **auto-opens the Exit modal** with the reason preset (new `DeactivateModal` `defaultReason` prop; mirrors the existing `?addNew=1` pattern). The exit endpoint already creates the offboarding checklist + reassignment items — so failing probation now flows straight into exit + offboarding instead of being three disconnected screens. Probation confirmation/extension letters were already inline on the probation page.
Frontend + additive type only; no server/rules/index change.

### My Activity — clickable status drill-down to contacts + fixed name picker (2026-07-20) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00120-cfq` + hosting, verify:deploy 3/3)
Two asks on the My Activity page (`MyActivityPage.tsx`): (1) the person picker box **grew to 3 lines** on a long name — fixed by adding `truncate min-w-0` to the shared `SearchableSelect` trigger value span (the flex trigger + fixed `w-52` now ellipsize instead of wrapping; global improvement). (2) The **"What the customers answered" status chips are now clickable** → drill into the actual contacts. Server: `GET /api/crm/activity/summary` returns a new **`contacts: [{leadId, name, mobile, status(bucket), model}]`** array (both lead models, capped 2000), collected in the old-model + CRM 2.0 loops. UI: chips became buttons (selected = filled); clicking one opens a scrollable panel of those customers — name + `PhoneLink` + `ContactActions` (Call/WhatsApp) + an **"Open ↗" link that opens the customer in a NEW TAB** (`/crm/leads/{id}` old-model · `/crm/pipeline/leads` CRM 2.0). The donut is also click-through (`RePie` gained an optional `onSliceClick`). Drill-down resets when the viewed person changes. So a manager clicks "Interested · 1" → sees who → opens the contact in a new tab. Frontend + additive server field; no rules/index change.

### CRM 2.0 Analytics "RM performance" shows NAME, not FAPL code (2026-07-20) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
The Analytics (`DashboardsPage.tsx`) "RM performance" table + horizontal bar chart printed raw **FAPL codes** (FAPL-022…) — codes are internal identifiers, never a way to represent an employee. Fixed: wired the existing **`useRmName()`** resolver (FAPL→displayName) into both the table cell (`rmName(r.rm)`, dropped `font-mono`) and the chart labels (`data={rows.map(r => ({ name: rmName(r.rm), … }))}`). Widened the shared horizontal `ReBar` category-axis width 110→132 (`charts.tsx`) so full names don't truncate. Extends the 2026-07-01 + 2026-07-18 raw-FAPL sweeps — the rule stands: **never render a bare FAPL person-code; resolve via `useRmName()`/`useRmInfo()`.** Frontend-only; no server/rules/index change.

### Lead-model unification — one normalizer for CRM 1.0 + CRM 2.0, no more sync/calc drift (2026-07-20) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00119-fzx`, backfill run, verify: live 15/16/8 all consistent)
The recurring calculation errors came from **two lead shapes in `/leads`** read inconsistently everywhere: old-model **Customers** (`primaryOwnerId` uid · `leadStatus` lowercase · `displayName`/`phone`/`createdAt` · no `receivedAt`; 1522 docs) and CRM 2.0 **Leads** (`assignedRm` FAPL · `status` UPPERCASE · `name`/`mobile`/`receivedAt`; 22 docs). Both screens are legitimate, distinct funnel stages (cold list → qualified pipeline) — the fix is ONE canonical read layer, not a merge. Built:
- **NEW `src/lib/crm2/leadModel.ts`** (pure, server+client, **12 unit tests**) — THE single source of truth: `isCrm2Lead` (has `receivedAt`), `isLeadDeleted` (only `deleted===true`), `leadBucket` (maps BOTH status enums → 8 unified buckets, converted wins), `LEAD_TERMINAL`/`isLeadOpen`/`isLeadTerminal`/`isLeadConverted`, `leadOwner` (**returns `{kind:'uid'|'fapl', value}` — the uid-vs-FAPL trap**), `leadName`/`leadMobile`/`leadCreatedMs`/`leadAttempted`. Server imports it as `./src/lib/crm2/leadModel.js`.
- **`server.ts` `accumulatePerf` + `/api/crm/activity/summary`** rewired to the normalizer (removed 2 duplicate `CRM2_TO_BUCKET` maps + duplicate terminal sets); both now attribute CRM 2.0 leads via `leadOwner` and bucket via `leadBucket`. Live-verified unchanged/correct: Team head 15 leads·2 conv·13%, My Activity tagged 16·attempted 14, Workload 8 open (8 open + 7 terminal = 15 total — provably consistent across endpoints).
- **THE `deleted` TRAP fixed for good**: CRM 2.0 leads created via the API omitted `deleted`, so `where("deleted","==",false)` silently excluded them. (a) **backfilled** `deleted:false` onto the 20 affected leads (0 remain); (b) all **8 CRM 2.0 lead-create objects** in `server/crm2.ts` now set `deleted:false`; (c) cross-model aggregations fetch ALL leads + filter `isLeadDeleted` in memory — **never** `where deleted==false`.
- **THE RULES (permanent):** ① any code reading `/leads` across models MUST use `leadModel.ts` — never hand-roll status/owner/deleted checks; ② never `.where("deleted","==",false)` on `/leads` in a cross-model aggregation (CRM 2.0 may omit the field) — fetch + `isLeadDeleted` in memory; ③ owner is uid (old) OR FAPL (CRM 2.0) — resolve via `leadOwner`. Note: `run-daily-briefing`/`run-monthly-scorecards`/`imports-performance` stay old-model-BY-DESIGN (they read old-model SLA/opportunities/imports; CRM 2.0 has its own SLA sweep + money pipeline). Money columns (disbursed/commission) still come from old-model `commission_records`/opportunities — CRM 2.0 money is in `misRecords`/`payoutCycles`; folding that into performance is the one remaining follow-on. No rules/index change.

**"Delete the old logic/cluster" — investigated 2026-07-20, DECLINED as unsafe (it is LOAD-BEARING, not dead).** Dependency trace: `useOpportunities`/`OpportunityCard` → live **Customers** pages (LeadDetailPage, LeadsPage); `commission_records` → CRM admin **home** (BusinessPulseHome) + **HRMS** employee-profile widget + **server performance** math + **payslip** incentive suggestion; `rm_payouts` → payslip generation. The old MIS pages are a self-contained UI island but their data collections are read cross-module. So there is NO cluster that can be deleted without breaking the daily Customers workflow, the admin home, or HRMS payslips. The two lead SHAPES are both live funnel stages (cold Customers → promote → qualified Leads → Client → Cases), not redundant. **The ghosting/calc-drift is already solved structurally by the normalizer above — deletion is NOT needed to fix it.** A true single-model app would require the staged 1522-Customer migration + rebuilt bulk import (Rahul declined for safety — correct). **Rule for any future session: do NOT try to remove the "old CRM/MIS" code as dead — it is load-bearing; simplify only via the normalizer + shared reads.**

### Full security + cost audit — non-breaking fixes ✅ DEPLOYED (2026-07-20)
A three-front read-only audit (backend endpoints · firestore/storage rules + secrets · cloud-cost leakage). **Only strictly non-breaking fixes were applied** (verified: `npm run lint` exit 0; only `firestore.rules`, `server.ts`, `server/crm2.ts` changed). **DEPLOYED via the owner account (finvastra@gmail.com):** `deploy:rules` (ruleset `918b4069`, verify:deploy 3/3) → `gcloud run deploy pulse-api --no-cpu-throttling` (**rev `pulse-api-00121-5rb`**, 100% traffic, verify:deploy 3/3). The CRITICAL leak below is now closed in prod. **Cost optimizations — INFRA PORTION APPLIED (2026-07-20):** Cloud Run switched to CPU-throttled billing (`gcloud run services update pulse-api --cpu-throttling`, **rev `pulse-api-00122-trk`**) so idle CPU is no longer billed 24/7; the four `*/15` reminder crons (`crm2-lead-sla-sweep`, `callback-reminders`, `crm2-followup-reminders`, `crm-meeting-reminders`) windowed to `*/15 2-20 * * *` UTC (≈ 07:30–02:30 IST) so the instance can scale to zero overnight (~2am–8am IST); `crm2-meta-retry` PAUSED (Meta pipeline dormant — **un-pause before Meta ads go live**). Net effect: warm/instant during active hours, asleep off-hours → est. total spend well under ₹1,000/mo (was ~₹6k). **Caveat:** with throttling on, post-ACK async webhook work (Meta/WhatsApp lead processing) may not finish after the HTTP response — the windowed retry jobs recover it during active hours; website intake is synchronous (unaffected). Both Meta+WhatsApp are currently dormant so no live impact; when they go live, ensure a retry cron covers off-hours. **Code-level cost items still pending (need a tested pass, NOT done):** bound the admin lead streams (`useLeads` admin branch, no `limit()`), add a terminal marker to `run-lead-sla-sweep`, wrap `GET /api/crm2/dashboards` + `/api/crm/activity/summary` in `cachedJson`.
- **CRITICAL rules fix (`firestore.rules` `hasMisAccess()`):** sync-claims stamps `misAccess` as `'admin'|'viewer'|null` on EVERY token, so the claim is present-but-null for non-MIS users. The old claim test `token.get('misAccess','') != ''` returned true for a `null` claim → **every claim-synced employee could read all `/commission_statements`, `/rm_payout_slabs`, `/rm_payouts` and update `/commission_disputes`.** Changed to `in ['admin','viewer']` (verified: `misAccess` is only ever those two strings or null; only `hasMisAccess` had the `!= ''` class of bug — all sibling helpers use safe `== true`/`== 'value'`). The DB `get()` fallback branch is unchanged (correctly reads the real doc).
- **server.ts (6 fixes):** (1) OAuth callback `postMessage` targetOrigin `'*'` → computed `appOrigin` (prod `pulse.finvastra.com`, dev `localhost:3000`, override via `APP_ORIGIN`) — stops token exfiltration to an attacker `window.opener`. (2) Legacy `POST /api/leads/intake/meta` now **fails closed** (403) when `META_WEBHOOK_SECRET` is unset (was skipping HMAC + creating leads from unsigned input; the superseded route). (3)+(4) rate limits on `forgot-password` (6/hr per IP+email, returns the same enumeration-safe `{ok:true}`) and `verify-reset-dob` (10/hr per IP, 429) — response shapes unchanged. (5) `escapeHtml()` applied to caller-supplied plain-text (title/intro/row label+value/note) in `buildBrandEmail` — `ctaLink`/`ctaLabel` left as system-built; all 12 callers verified plain-text so normal emails render identically. (6) `/api/leads/intake/website` secret compare → constant-time `crypto.timingSafeEqual`.
- **server/crm2.ts (2 fixes):** (A) `POST /api/crm2/perms/:uid` now 403s when the TARGET is a super admin and the caller is not (mirrors sync-claims' SA protection, via the in-file `superAdminUidsFromEnv()`). (B) both `WEBSITE_WEBHOOK_SECRET` header compares → constant-time `safeEqual()` (keeps the fail-closed `!!secret &&` guard).
- **DELIBERATELY DEFERRED (would break / migrate / deploy — documented, NOT applied):** raw `panRaw` on `/leads` readable by any `crm.leads.read`/`socialAccess` user (needs the `panEncrypted` migration to a `/leads/{id}/private` subdoc — data migration); domain check in `isSignedIn()` (email/password accounts default `email_verified:false` → **lockout risk**); removing `sharedModules` from write rules (breaks page-sharing writes); `commission_records` create `hasOnly` (risk of breaking creates without the exact field list); IT-declaration self-accept constraint; random per-user temp password; WhatsApp-thread read tightening; `audit_logs create:if false` (**client admin pages DO write it directly** — `SuperAdminPermissionsPage`/`EmployeesPage`, so this would break admin logging); Scheduler OIDC `audience` pinning (wrong value → **all 16 crons 401** — verify job audience first). Residual: `notify/email` accepts a client-built `htmlBody` (`buildHrEmailHtml` in `src/lib/notifications.ts`) — escape there in a follow-up.
- **COST (biggest finding — infra/deploy actions for the maintainer, NOT code):** Cloud Run runs `--no-cpu-throttling` (1 vCPU/512Mi, maxScale 3, no min-instances) but 6 crons fire every 10–15 min 24/7, so the instance never scales to zero → **est. ₹5–6k/mo, ~85–90% of spend, over the ₹4k budget by itself.** Recommended (maintainer): redeploy WITHOUT `--no-cpu-throttling` (retry jobs already recover any dropped async webhook work); pause `crm2-meta-retry` (Meta pipeline dormant, polling every 10 min since June); add business-hours time windows to the `*/10`–`*/15` crons; bound the admin lead streams (`useLeads` admin branch streams all ~1500 leads with no `limit()` on both BusinessPulseHome and LeadsPage, re-fetched every nav since the b815 memory-cache change); add a terminal marker to `run-lead-sla-sweep` (re-scans the same ~1500 cold leads + an activities sub-query each, every 15 min); wrap `GET /api/crm2/dashboards` + `/api/crm/activity/summary` in the existing `cachedJson`. Clean: no committed secrets, no PII in logs, encryption key server-only, CRM 2.0 money authz solid.

### Performance counts BOTH lead models — CRM 2.0 leads were invisible (2026-07-20) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00117-b7l`, verify: live-data 15 leads)
Rahul (FAPL-022, super-admin) saw only **1 lead** on his Performance "own performance" card while the Leads table showed ~15 he was actively working. **Root cause:** `accumulatePerf` (`server.ts`, powers `/api/crm/team/performance` + `/all-teams`) and `/api/crm/activity/summary` (My Activity) counted leads by **`primaryOwnerId` (uid) only** — old-model Customers — so every **CRM 2.0 lead (keyed by `assignedRm` = FAPL code)** was uncounted. **Two fixes:** (1) both endpoints now attribute CRM 2.0 leads via a **FAPL→person map** (`byFapl`), mapping CRM 2.0 statuses (NEW/CONTACTED/QUALIFIED/CONVERTED/…) into the same buckets so counts, conversion %, attempted/untouched read consistently; a lead is CRM 2.0 when `receivedAt != null` (else old-model). (2) **CRITICAL** — `accumulatePerf`'s leads query was `where("deleted","==",false)`, but **CRM 2.0 leads created via the API omit the `deleted` field entirely**, so that filter silently excluded ALL of them (head showed 0 after fix #1 until this) → query changed to fetch all leads + **filter `deleted === true` in-memory** (the pattern already used elsewhere). Live-verified: Rahul's head = 15 leads / 2 converted / 13% (was 1). **Rule: any query filtering `deleted == false` on `/leads` MUST instead fetch + filter in-memory, because CRM 2.0 leads don't set the field.** Server-only; no rules/index change. **Note:** money columns (disbursed/commission) still come from `commission_records`/opportunities (old model) — CRM 2.0 money lives in `misRecords`/`payoutCycles`; unifying that is the follow-on "single lead model" task.

### Workload tab — who is handling what, across all three entity types (2026-07-20) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00113-w6z` + hosting, verify:deploy 3/3)
Rahul: an uncomplicated view of who is handling every contact — customers, leads AND cases — under Performance, zero learning curve. Built:
- **NEW `GET /api/crm/workload`** (`server.ts`, auth admin || SA || `crmRole:manager`, 45s `cachedJson` + `?fresh=1`): one scan of `leads` + `cases` + `users` → per active CRM person their OPEN counts — **customers** (old-model, `primaryOwnerId`, not deleted/closed), **leads** (CRM 2.0, `assignedRm`, not converted/terminal), **cases** (`handlingRm`, stage not COMPLETED/CLOSED) + **shared** (case `collaborators`) — plus the **unassigned bucket** (UNASSIGNED customers / queue leads / handler-less cases) and an `idle` count. Terminal sets mirror the app's.
- **NEW Performance hub tab `?tab=workload`** ("Workload", manager/admin, second pill) — `src/features/crm/performance/WorkloadSection.tsx`: a red-bordered "Nobody is holding these yet" strip (chips deep-link to Import Queue / Leads / Cases), then ONE roster table — avatar+name (+"+N shared" chip), colour-coded Customers/Leads/Cases count pills, Total, **Details →** deep-linking to `?tab=team&uid=` — with a TEAM TOTAL footer, person search, Refresh, and a one-line "open work only" explainer. No config, no drill-down learning — read and act.
No rules/index change (Admin-SDK reads).

### Task cards: comments replace click-to-edit (2026-07-18) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00112-bm7` + hosting, verify:deploy 3/3)
Rahul: instead of editing a task, people should COMMENT on it — each remark marked with who said it and when ("makes more sense than editing"). Changes:
- **UI (`TasksPage.tsx`)**: the click-to-edit path is GONE — `TaskEditModal` removed, cards no longer clickable, "edited" chip dropped. Cards gain a **💬 button** (with comment count) in the footer → inline composer (Enter or Send); the **comment thread renders on the card** — text + "— Name · 18 Jul, 4:05 pm" (author gold). Ticking checklist items on the card stays.
- **Server (`server/crm2.ts`)**: task PATCH accepts **`comment`** (1–1000 chars) → `arrayUnion({by, byName, text, at: Timestamp.now()})` on new **`comments[]`** (never `serverTimestamp()` in arrays) + **bells the other side of the task** (assignee ↔ creator, never self, type `task_assigned`). The PATCH content-edit fields (title/text/items/color/dueAt) remain API-supported (editedAt stamp intact) — only the UI edit surface was removed.
No rules/index change (crm_tasks writes stay server-only).
**Visibility follow-up (2026-07-20, hosting-only, verify 3/3):** the comment affordance was too subtle — the footer button is now a gold-outlined **"💬 Comment (N)"** pill (solid gold while open) and the composer is a highlighted gold-bordered panel ("💬 Your comment" label, larger input, focus ring).

### Not-Eligible register — manager/SA tracking view across both models (2026-07-18) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00111-2th` + hosting, verify:deploy 3/3)
Rahul: managers + super admins need the complete view of every not-eligible customer, stored. The data already lives on the lead docs; built the consolidated register on top:
- **NEW `GET /api/crm/not-eligible`** (`server.ts`, auth admin || SA || `crmRole:manager`, 45s `cachedJson` + `?fresh=1`): combines old-model (`leadStatus=='not_eligible'`, skips deleted) + CRM 2.0 (`status=='NOT_ELIGIBLE'`) — both single-equality auto-indexed queries — resolving marker/owner uid+FAPL → display names. Row: `{model customer|lead, name, mobile, creditScore, reason, markedBy, markedAt (leadStatusAt / updatedAt), owner, link}`.
- **NEW page `/crm/reports/not-eligible`** (`src/features/crm/reports/NotEligiblePage.tsx`; nav node **`crm.not-eligible`** "Not Eligible" `UserX`, CRM **Manage** group, access `crmManager`): summary strip (Total · This month · Avg CIBIL of scored · Other-reason-only) + search (name/mobile/reason/who) + register table (source chip Customers/Leads, CIBIL, reason, marked-by, owner, when, Open→ link) + **Export CSV** for offline storage.
No rules/index change (Admin-SDK reads; single-field queries).

### "Not eligible (CIBIL)" on CRM 2.0 Leads + credit-score confirmation box on BOTH lead models (2026-07-18) — ✅ DEPLOYED (rules ruleset `60ac2119` + Cloud Run rev `pulse-api-00109-hq4` + hosting, verify:deploy 3/3)
Rahul: leads/customers rejected on CIBIL need the same closing status in the LEADS tab as Customers, plus a box to enter the credit score as confirmation — applicable to both. Built:
- **CRM 2.0**: `Crm2LeadStatus` gains **`NOT_ELIGIBLE`** (terminal — added to server `LEAD_STATUSES` + `CRM2_TERMINAL_STATUS`, `sla.ts CRM2_TERMINAL`, TasksPage terminal set; STATUS_META "Not eligible (CIBIL)" rose + funnel chip). New **`Crm2LeadFields.creditScore`** — lead PATCH validates 300–900. Drawer: picking Not eligible opens a **confirmation box** (score input, Mark Not eligible / Cancel — status only changes WITH a valid score); "CIBIL score on record: N" shows under Status thereafter.
- **Old CRM (Customers)**: `Lead.creditScore` added; `handleDisposition('not_eligible')` now intercepts → same score box inline under the Status select → saves status + score + slaDeadline-clear in one `updateWithHistory` batch; score chip shown on the record. **`firestore.rules`** leads owner-update `hasOnly` gains `'creditScore'` (the one rules change).

**Follow-up (same day, rules ruleset `a9074308` + Cloud Run rev `pulse-api-00110-xpb` + hosting, verify 3/3):** rejection isn't always CIBIL — the confirmation box now takes **the score, a free-text reason, or both** (≥1 required; button disabled otherwise). New **`notEligibleReason`** field on BOTH lead models (crm2 PATCH sanitizes ≤500 chars; old-model rules allowlist gains `'notEligibleReason'`); CRM2 status label relabelled plain "Not eligible"; the on-record chip shows `CIBIL: N · reason` as available.
### Task board: search · three-group split · click-to-edit + "edited" tag (2026-07-18) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00108-7h5` + hosting, verify:deploy 3/3)
Rahul: the board mixed self-created and received tasks; wanted search, a distinct "assigned to me by others" group, and clickable/editable cards with an edit marker. Built (`TasksPage.tsx` + `server/crm2.ts`):
- **Search bar** next to the Board|Calendar toggle — live client-side filter over title/text/checklist items/creator/assignee names; empty-state when no match.
- **Three clear groups** (replaces the two): **Assigned to me** (createdBy != me — incoming work, blue, always on top, shows "from X") · **My tasks** (self-created, gold) · **Assigned by me** (to others, purple).
- **Click-to-edit**: any card opens **`TaskEditModal`** — title, note text, checklist items (edit text inline / tick / remove / add; adding an item to a note converts it to a checklist), colour, due datetime. Saves via the generalised PATCH (assignee/creator/manager). Done button + checklist ticks `stopPropagation` so they don't open the editor.
- **"edited" tag**: the task PATCH now stamps **`editedAt`/`editedBy`** whenever CONTENT fields change (title/text/color/items/dueAt — status ticks excluded); the card meta row shows a small "edited" chip (hover = when).

### Exit/offboarding works for employees WITHOUT a login account (2026-07-18) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00107-6km`, verify:deploy 3/3)
Marking a no-login employee (needsEmailSetup staff — e.g. P.A.N.V. Ravi Kumar; ~6 employees have no @finvastra.com Auth account) as Exited failed with Firebase Auth's "There is no user record corresponding to the provided identifier" — `POST /api/admin/employees/:uid/deactivate` called `admin.auth().updateUser(uid,{disabled:true})` + `revokeRefreshTokens` unconditionally and aborted the WHOLE exit before touching the HR record. Fix (`server.ts`): both **deactivate** and **reactivate** wrap the Auth step in a try/catch that tolerates ONLY `auth/user-not-found` (nothing to disable/enable — Firestore status update, offboarding checklist, CRM-reassignment check and audit log all proceed); any other auth error still aborts so an active login is never left behind on an exited employee. Server-only; no rules/index/hosting change.

### Active reps show name + profile-photo avatar, never the FAPL code (2026-07-18) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Rahul: FAPL codes are internal identifiers only — never a way to represent an employee in the UI; show the name + profile photo (the avatar denotes who's actively working). New **`useRmInfo()`** in `src/features/crm2/lib.ts` (FAPL → `{name, photoURL}`, same pattern as `useRmName`). **`QueuePanel`** Active-reps rows rebuilt: profile photo (or gold initials circle) with a **green presence dot** + display name + "N open" (was a bare `font-mono` FAPL). **Case History** actor line (`CaseWorkspacePage:404`) now renders `rmName(h.by)` instead of the raw code. This closes the last raw-FAPL displays found by grep (the 2026-07-01 sweep covered the list columns). Rule stands: **never render a bare FAPL person-code — resolve via `useRmName()`/`useRmInfo()`.** Frontend-only; no server/rules/index change.

### Add-Login form — alphabetical lender list + SM/ASM auto-populate from the lender master (2026-07-17) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Rahul: the Add-Login bank picker wasn't alphabetical, and the SM/ASM contact details saved on the lender master (Masters → Lenders `contacts[]`) had to be re-typed on every login. Fixes in `LoginsSection.tsx` (File/Bank Login stage, manager-only Bank Contacts block): (1) **lender picker sorted alphabetically** (`localeCompare`); (2) new **`ContactNameInput`** — SM Name / ASM Name are now free-text inputs backed by a **datalist of the selected lender's saved contacts for that role**; picking (or typing) a matching name **auto-fills their number + email** (+ branch when the branch field is empty); (3) **selecting the bank itself prefills** the SM (and ASM) block immediately when the lender has **exactly one** saved contact of that role and the fields are still empty (the Axis→Sneha case) — gated on `canSeeBankContacts`, never overwrites typed values. Free text still allowed for contacts not yet in the master (the login PATCH auto-accumulates new SM/ASM into the lender master, unchanged). Frontend-only; no server/rules/index change.
**Follow-up (same day, hosting-only, verify 3/3):** "only works for Axis" — live-data inspection showed the code was fine but (a) the datalist type-to-suggest was INVISIBLE until typing (SMFG's 2 SM + 3 ASM never auto-pick, so nothing appeared), and (b) HDFC/Aditya Birla/Godrej×2 have ZERO saved contacts in the master (data gap, not code). Fix: `ContactNameInput` rebuilt — when the lender has saved contacts for the role it renders a **visible `SearchableSelect` dropdown** (label `name · mobile`; pick → number/email/branch fill) with a **"➕ New (type manually)"** escape to free text (+ "← pick from saved" to switch back); keyed `sm-/asm-${lenderId}` at the call sites so switching banks resets the mode. Lenders with no saved contacts get the plain input. **Data actions for the maintainer:** add SM/ASM contacts on HDFC (LEN-001) / Aditya Birla (LEN-003) / Godrej HF (LEN-005) / Godrej Capital (LEN-006) in Masters → Lenders; clean SMFG's junk test contacts ("Govinf", "wjehfk").
**Follow-up 2 (same day, hosting-only, verify 3/3):** switching to a DIFFERENT lender kept the previous bank's SM/ASM/branch values in the form (the picker remounted via the lender key but the `f` state didn't reset) — the lender `onChange` now clears branch + all six SM/ASM fields when `v !== p.lenderId` before applying the new bank's single-contact prefill.

### Keep-style task board — colours, checklists, due-today default, due reminders (2026-07-16) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00106-xx2` + hosting, verify:deploy 3/3)
Rahul asked for a Google-Keep-like task experience: default today's date, follow-up email+bell on due, multi-line/checklist tasks, mobile-optimised. Built INSIDE the existing `crm_tasks` system (better than Keep for us — cards ride Pulse's bell/email rails and sit next to lead follow-ups):
- **Task schema (additive, `crm_tasks`)**: `title`, `color` (Keep palette enum default/red/orange/yellow/green/teal/blue/purple, `sanitizeTaskColor`), `items` (checklist `[{id,text,done}]` cap 50, `sanitizeTaskItems`), `reminderSent`. `POST /api/crm2/tasks` accepts them (text OR title OR items required; text cap 4000); **`PATCH /api/crm2/tasks/:id` generalised** — status AND title/text/color/items/dueAt editable by assignee/creator/manager; **changing `dueAt` re-arms `reminderSent:false`**.
- **Due reminders**: the 15-min sweep `run-crm2-followup-reminders` (`server.ts`) gained a third pass — open `crm_tasks` with `dueAt <= now+15min` & `!reminderSent` → **bell (`task_assigned`) + branded email to the assignee**, then `reminderSent:true` (single-equality query, no index; rides the `crm2_followup_reminders` notification-settings gate).
- **UI (`TasksPage.tsx`)**: **KeepComposer** — collapsed "Add a task or note…" row (+ checklist shortcut icon) expands into a Keep note card: Title, multi-line note OR checklist items (Enter to add), **colour dot picker**, **due defaults to TODAY 18:00** (`defaultDue()`), For-person picker (managers). **TaskKeepCard** masonry board (`columns-1 sm:columns-2 xl:columns-3`, break-inside-avoid): colour-tinted card (rgba tints — theme-safe both modes), bold title, `whitespace-pre-wrap` body, **tickable checklist items with n/N progress**, due chip (overdue red border), ✓ Done. List toggle relabelled **Board | Calendar**; calendar labels use `title||text`; mobile = 1-col masonry + smaller day cells. Deliberately NOT built (scope): Keep's labels/archive/pin/images.

### Partner-funnel option restricted to Partner Sign-up leads only (2026-07-16) — ✅ DEPLOYED (Cloud Run rev `pulse-api-00105-kls` + hosting, verify:deploy 3/3)
Rahul: a website LOAN lead was showing "Move to Partner funnel" — only queries from the Partner sign-up page may go there. Fixes: (1) **UI** — `PromotePartnerRow` in the lead drawer now renders ONLY when `lead.category === 'PARTNER_DSA'` (previously it showed on every lead with softer copy); the non-partner copy branch removed. (2) **Server** — `POST /api/crm2/leads/:id/promote-partner` now 400s unless `category === 'PARTNER_DSA'` ("change the lead's Category to 'Partner Sign-up' first…"), so the rule holds even against direct API calls. (3) **Escape hatch** — the lead drawer gained a **Category picker** (`CATEGORY_OPTS`, PATCH `category`) so a genuine partner request that arrived mis-categorised can be recategorised to Partner Sign-up (which then reveals the funnel button). No rules/index change.

### Tasks To-Do tab + ad-hoc task assignment + reassign bell (2026-07-15) — ✅ DEPLOYED (rules ruleset `15c2efb3` + Cloud Run rev `pulse-api-00103-nxg` + hosting, verify:deploy 3/3)
The Tasks page previously showed only Queue/Meetings/Case-tasks — a rep's due follow-ups/callbacks never surfaced, and forwarding a lead to someone produced NO notification and nothing in their Tasks (the user's Kumar case). Built three things:
- **To-Do tab (new DEFAULT tab on `/crm/tasks`, `TasksPage.tsx` `ToDoSection`)** — one action radar per user, live via onSnapshot: ① **Tasks assigned to me** (new `crm_tasks`, below) with ✓ Done + overdue highlight; ② **Lead follow-ups due** (CRM 2.0 leads `assignedRm == my FAPL`, non-terminal, `nextFollowUpAt` within 48h/overdue — gated by `crm.leads.read`, reuses the `leads(assignedRm,receivedAt)` index); ③ **New leads — make the first call** (assigned, `firstContactedAt == null`, status NEW/ASSIGNED, oldest first, cap 15 + link); ④ **Customer callbacks** (old-model `primaryOwnerId == uid && leadStatus == 'callback'`, existing index) linking to `/crm/leads/{id}`; ⑤ managers also see **"Tasks I assigned (open)"**. All sections fail-safe (denied query → section hidden).
- **Ad-hoc task assignment** — manager/admin/super-admin clicks **"Assign a task"** → picks ANY active employee + text + optional due datetime → **`POST /api/crm2/tasks`** (auth `getCallerMeta.isManager`; validates assignee) writes **new collection `crm_tasks/{id}`** `{assignedTo(uid), assignedToName, text, dueAt, link, status open|done, createdBy/Name, createdAt, doneAt/By}` + **bells the assignee (new NotificationType `task_assigned` ✅, added to both unions + bell TYPE_META) + branded email** (`sendBrandedEmail`, best-effort). **`PATCH /api/crm2/tasks/:id {status}`** — assignee/creator/manager marks done/reopens. **Rules**: `crm_tasks` read = assignee || creator || admin/manager; **write=false** (server-only). Client reads are single-equality (`assignedTo==uid` / `createdBy==uid`) → no composite index.
- **Lead-reassign bell** — `PATCH /api/crm2/leads/:id` now notifies the NEW RM (type `new_lead`, link `/crm/tasks`) when a manager changes `assignedRm` — the forwarded lead also lists under their To-Do "make the first call"/follow-ups sections automatically.

### Editor settings (2026-07-15) — `.vscode/settings.json` (committed)
NEW `.vscode/settings.json` with a single setting: `"tailwindCSS.lint.suggestCanonicalClasses": "ignore"` — silences the Tailwind IntelliSense "can be written as …" style hints (37 cosmetic warnings on arbitrary values like `max-w-[140px]` / `focus:ring-[#0B1538]`, which are intentional). Editor-only; no build/lint/runtime effect.

### Leads priority dot/pill now reflect the ACTUAL priority (2026-07-01) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
A user changed a website lead's priority to Medium in the drawer but the list still showed a RED dot + "HIGH" pill — looked like it didn't save. **It DID save** (the drawer's Priority `SearchableSelect` PATCHes on change, instantly, live-refreshed via `useCrm2Leads` snapshot). The bug was **presentation**: the 2026-06-22 change **force-colored the list dot red + showed a HIGH pill for `HOT_SOURCES` (WEBSITE/ADS) regardless of the stored priority**, so a manual change never showed. Fixed (`Crm2LeadsPage`): dropped `HOT_SOURCES`; the dot now uses `PRIORITY_META[r.priority].dot` and the "HIGH" pill shows only when `r.priority === 'HOT'`. Website/social leads are still created HOT (red) server-side by default, but a manual priority change now **sticks and shows** (dot turns yellow/green, HIGH pill drops). Hosting-only; no server/rules change.

### Notification subscription toggles — super-admin on/off per automated alert (2026-07-01) — ✅ DEPLOYED (rev `pulse-api-00088-9wc` + hosting, verify:deploy 3/3)
A super-admin page to turn the platform's **automated/recurring** emails + bells on/off company-wide (the monthly scorecard email prompted this). Decision (Rahul): **super admins edit global, managers view; covers all automated alerts** (not one-off approval confirmations).
- **Config doc `app_config/notification_settings`** — a key is stored only when a notification is turned OFF (`false`); absent/true = ON (so existing behaviour is unchanged until someone toggles). Rules unchanged (existing `app_config` block: read signed-in, write admin/HR — super admins are admins; the UI gates *edit* to super admins, managers see read-only).
- **Server gate `notificationsEnabled(key)`** (cached 60s) added in **`server.ts`** AND **`server/crm2.ts`**; each of the **12 notification-sending scheduled jobs** early-returns `{skipped:'notifications_disabled'}` when its key is off: `monthly_scorecards · daily_briefing · weekly_team_digest · callback_reminders · meeting_reminders · followup_reminders · crm2_followup_reminders · lead_sla_sweep · bank_sla_check · document_expiry_check · commission_leakage_check · payout_reminders`. The **4 pure data jobs** (meta-retry, whatsapp-retry, vault-expiry, recon-snapshots) are NOT gated (they don't notify). Manual `generate-scorecard/:uid/:period` is NOT gated (explicit admin action).
- **BUGFIX (same change): scorecard email subject mojibake** — `sendGmailWithAttachment` built `Subject: ${subject}` RAW (unlike `sendGmailMessage` which RFC-2047-encodes), so "—" showed as `Ã¢Â€Â"`. Now encodes via the existing `encodeEmailSubject`.
- **Frontend**: `src/config/notifications.ts` (the 12-item `NOTIFICATION_TOGGLES` registry, keys must match the server) + `src/features/admin/NotificationSettingsPage.tsx` (grouped toggle switches, super-admin edit / manager+admin view, live `onSnapshot`).
- tsc + build clean; no rules/index change.
- **Moved into CRM (2026-07-01, hosting-only):** the page was initially a hidden standalone `/admin/notifications` reachable only from a launcher top-right link (user found it too buried). Now it lives at **`/crm/admin/notifications` inside the CRM shell** with a **"Notifications" item in the CRM sidebar → Admin group** (nav node `crm.notifications`, `BellRing`, access = SA || admin || CRM manager). The page renders as in-shell content (dropped the full-screen navy wrapper + "back to home"). Old `/admin/notifications` now **redirects** to the CRM route; the launcher shortcut repoints there too.

### CRM 2.0 shows RM NAME, not the FAPL code (2026-07-01) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
CRM 2.0 stores people as FAPL-### codes (`assignedRm`/`handlingRm`/`ownerRm`/`collaborators`); several surfaces printed the raw code (e.g. Leads list "RM = FAPL-022"). Added one shared resolver **`useRmName()`** in `src/features/crm2/lib.ts` (maps FAPL→`displayName` via `useAllEmployees`; returns the code if the employee is gone, '—' if empty) and applied it to the raw-code spots: **`Crm2LeadsPage`** (RM column), **`Crm2CasesPage`** (Handling RM column), **`Crm2ClientsPage`** (Owner RM column — also dropped `font-mono`), **`CaseWorkspacePage`** (header "RM …" + Client-ID tab "Owner RM" row). Pickers already showed names (`SearchableSelect`); the collaboration tab + client-detail already had a local resolver. **Rule going forward: never render a bare FAPL person-code — wrap it in `useRmName()`.** Hosting-only; no server/rules/index change.

### Offline story made honest — online-only + fast PWA (2026-07-01) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
The app advertised **"works offline"** (install banner) + **"changes will sync when you reconnect"** (offline banner), but a user offline **can't sign in** (Firebase Auth verifies credentials online — `signInWithEmailAndPassword` throws `auth/network-request-failed`; there is NO offline login and there shouldn't be) and **can't load data** (Firestore offline persistence was removed to fix the b815 crash → an already-signed-in user offline hits `profileLoadFailed`). The PWA only precaches the app SHELL. So the "offline" claims were false. Decision (Rahul): **be honest — online-only + PWA for fast home-screen access**; do NOT attempt offline login (impossible) or re-enable persistence (b815 risk). Copy/UX-only, hosting-only:
- `InstallAppBanner.tsx`: subtitle "…· works offline." → "…· instant launch."
- `OfflineIndicator.tsx`: "changes will sync when you reconnect." → "Pulse needs a connection to sign in and load data."
- `LoginPage.tsx`: imports the existing `useOnlineStatus` hook; `handleSubmit` short-circuits when offline with "You're offline — connect to the internet to sign in." (no raw SDK error); the Sign in button is **disabled offline** ("Offline — connect to sign in") with a "Sign-in needs an internet connection." note; `AUTH_ERRORS['auth/network-request-failed']` reworded to an offline-clear message.
- `LauncherPage.tsx`: the `profileLoadFailed` screen is **offline-aware** — when `!navigator.onLine` it shows "You're offline / Pulse needs an internet connection to load your account and data…" instead of the generic "brief connection hiccup" copy (Reload/Sign out kept).
**Doc correction:** earlier notes calling IndexedDB offline persistence "the offline data layer" (Phase P / firebase.ts comments / vite PWA comment) are superseded — Pulse is **online-only**; the PWA = install + instant launch, not offline data/auth. tsc + build clean; no rules/server/index change.

### BUGFIX — Firestore "INTERNAL ASSERTION FAILED b815" crash (offline cache) (2026-06-30) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Kalyan hit a wall of red ("FIRESTORE (12.12.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)") when applying for leave. **Root cause — NOT our code:** prod initialised Firestore with **`persistentLocalCache({ tabManager: persistentMultipleTabManager() })`** (IndexedDB offline + multi-tab). That exact config is the documented trigger for the Firestore JS SDK's b815/ca9 internal assertion in the offline-cache/listener layer (stack was all `pc.We`/`qm.forEachTarget`/`qg.onNext` — the watch/persistence layer), surfacing as a raw crash on any page with live listeners + a write. **Fix:** `src/lib/firebase.ts` now uses the **default in-memory cache** (dropped `persistentLocalCache`/`persistentMultipleTabManager`/`CACHE_SIZE_UNLIMITED`) — no IndexedDB, so the assertion can't occur. Trade-off: no offline Firestore *data* caching (acceptable — internal tool, uncapped `pulse` DB, ₹4k budget alert; PWA shell + live listeners unaffected; existing corrupted IndexedDB is simply no longer opened → self-heals on next load). **Also:** `ApplyLeavePage` no longer dumps raw SDK errors — `console.error`s the detail and shows a clean message (internal/Firestore errors → "Something went wrong on our side. Please refresh and try again — your leave was not submitted."). **Rule going forward: keep Firestore on the memory cache; do NOT re-enable `persistentLocalCache` unless the b815 SDK bug is confirmed fixed in the pinned SDK version.** Hosting-only; no rules/server/index change.

### Attendance-correction request → manager notification (+ HR fallback) (2026-06-30) — ✅ DEPLOYED (rev `pulse-api-00087-cvg` + hosting, verify:deploy 3/3)
**What failed:** `submitRegularization` only wrote the `/attendance_regularizations` doc — it **notified nobody**. The manager only ever saw a badge on the admin Attendance nav if they happened to look; no bell/email fired. (Only leave + claims were wired to the manager-notify path; attendance was missed.) **Built:** wired the RegularizeModal submit to **`notifyManagerOfRequest({kind:'attendance', …})`** (link → `/hrms/admin/attendance`). The **`/api/hrms/notify/manager`** endpoint was generalised: `kind` now also accepts `'attendance'`; and **routing gained an HR/admin fallback** — it notifies the caller's **active reporting manager**, else falls back to **all active `isHrmsManager` + `role:'admin'`** users (so a request is never lost when the manager is unset/inactive — the "HR can do it if the manager isn't available" rule). New `NotificationType` **`attendance_request`** (🕒) added to `lib/notifications.ts` + `types/index.ts` + NotificationBell `TYPE_META`. **Approval unchanged** — still admin/`isHrmsManager` (HR), which is why Rahul (admin) can approve via the Corrections tab once notified; the request also still surfaces there. _Follow-up (NOT built, flagged): letting a NON-admin reporting manager (e.g. `crmRole:manager` without `isHrmsManager`) actually APPROVE corrections needs a manager Corrections view + a rules change (`isManagerOf(employeeId)` on `/attendance_regularizations` update). Today the manager is notified; the approve action stays with HR/admins._ Server + hosting; no rules/index change.

### Server-side duplicate check — works for everyone, no contact leak (2026-06-30) — ✅ DEPLOYED (rev `pulse-api-00086-tgx` + hosting, verify:deploy 3/3)
Follow-up to the silent-Save fix: telecallers were SKIPPING the dup check (couldn't run the cross-owner query). New **`POST /api/leads/check-duplicate {phone, panRaw}`** (Admin SDK; auth = admin || crmAccess || any crmRole) checks across ALL leads and returns a **minimal verdict** `{duplicate, matchType, name, ownedByYou}` — never another rep's phone/PAN/owner — so duplicates are caught at entry for telecallers too, without leaking contacts. Index-free (queries `phone ==` / `panRaw ==`, filters soft-deleted in memory). Client helper **`checkDuplicateServer`** (+ `DuplicateVerdict` type) in `duplicateDetection.ts`; **`NewLeadPage`** now uses it (replaces the rules-blocked client `checkForDuplicates`), and the warning reads "already in your list" vs "already exists in the system" by `ownedByYou`. Force-create (OK on the confirm) kept for genuinely-different same-number cases. `checkForDuplicates` (now resilient) retained for any other caller. Server + hosting; no rules/index change.

### BUGFIX — "Save Customer" silently failed for telecallers (2026-06-30) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
A telecaller (non-admin/non-manager) adding a New Customer got NO confirmation and nothing saved. **Root cause:** `NewLeadPage.onSubmit` called `checkForDuplicates(phone, pan)` **before** its try/catch; that helper runs `getDocs(query(leads where phone==X where deleted==false))` — a **cross-owner** query. The leads `list` rule only lets a non-admin list `primaryOwnerId == own uid`, so the query throws `permission-denied` for telecallers; being outside the try, the throw was swallowed by react-hook-form's `handleSubmit` → silent dead Save. Admins/managers can list all leads so they never hit it. **Fix (hosting-only, no rules change):** (1) `checkForDuplicates` now wraps each query in try/catch and returns `[]` on error — the dup check is a convenience, not a security gate, so it skips gracefully for users who can't run it (server/import dedup still protect); (2) `onSubmit` moved the dup-check + create INTO the try/catch so any failure surfaces in the error banner instead of dying silently. The create itself was always allowed for telecallers (`hasCrmAccess() && isValidLead()`). _Follow-up option (not built): a server-side `/api/leads/check-duplicate` (Admin SDK) so telecallers also get dup warnings._

### importExtras also shown in the Customers LIST + backfill re-share guidance (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00085-zbc` + hosting, verify:deploy 3/3)
Follow-up: the imported extra columns (amount, city, …) were only on the lead DETAIL card; now they ALSO show as a compact muted line in the **Customers list** (`LeadsPage` desktop rows under the name + mobile cards), truncated with a full-text `title`, so telecallers see the context without opening each customer. **Important data note**: the live batch `2026-06-29-EHS9` ("Latest Data 2018 (Ajay)") was imported BEFORE importExtras shipped → its leads have `hasExtras:false`. Backfill re-reads the sheet, but the sheet is **no longer shared** with the Sheets SA (ADC = `787616231546-compute@developer.gserviceaccount.com`) — backfill returned `400 "caller does not have permission"`. The backfill endpoint now returns an **actionable** permission error naming the SA to re-share with. **To populate the amount on the existing batch: re-share that Google Sheet (Viewer) with the compute SA, then Import History → "Backfill details".** New imports capture importExtras automatically (no action). _(Triggered the backfill as admin via a custom-token→ID-token→endpoint call; it reached the sheet read and failed only on sheet permission, confirming the auth path + the re-share requirement.)_

### My Queue = pull-only for telecallers; bulk contact list is manager/admin-only (2026-06-29) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
Follow-up to the count-only pull: on **Tasks → My Queue**, **telecallers (lead_generator/lead_convertor) no longer see ANY contact list** — only the available **count** + a **selectable pull (any number, hard-capped 100)**. `MyQueuePage` `canSeeContacts = isManager || isAdmin`: telecallers pass `''` to `useMyLeads` so **no contact data is even fetched** to their browser; the stat chips + lead table render only for managers/admins. The pull button gained a number input (1–`PULL_LIMIT`=100). Telecallers call their pulled leads from **Customers** (`/crm/leads`, which already scopes a non-admin to `primaryOwnerId == own uid` — their own assigned leads only, never the pool); the panel note points them there. Pool count stays server-side (`/api/leads/pull/available`); pull hard-capped 100 server-side. Hosting-only; no rules/server change (data layer was already correct — rules block listing the unassigned pool).

### Telecaller pull = count-only, max 100 (no contact leakage) (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00082-tjr` + hosting, verify:deploy 3/3)
Telecallers must NOT see the unassigned pool's contacts (names/phones = leak risk) — only **how many** are waiting, and pull **max 100** at a time. The data layer already enforced this (the leads `list` rule allows a non-admin only `primaryOwnerId == own uid`, so the pool isn't listable by them; `useLeads` gives a non-admin only their own leads; the Customers page's unassigned filters/bulk-reassign are admin-only). Hardened the pull UX on top:
- **`GET /api/leads/pull/available`** (new; telecaller/manager/admin) → `{ available }` = server-side `count()` of UNASSIGNED non-deleted leads. **Only the number crosses the wire — never the contacts** (telecallers can't run this query client-side; rules block it). Returns `available: null` if the count fails (UI hides the number, button still works).
- **`POST /api/leads/pull` cap lowered 200 → HARD 100** per pull.
- **`MyQueuePage`** pull control rebuilt: removed the free count input; a clean panel shows "**N contacts available to pull**" (number only) + a single **"Pull up to 100"** button (disabled when 0), refreshing the count after each pull. No contact data is ever rendered from the pool.
tsc + build clean; no rules/index change (rules already correct).

### Import Queue — leftover (uncapped) contacts were invisible (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00081-p9q` + hosting, verify:deploy 3/3)
After a **cap-per-agent** distribute (e.g. 200×3 = 600 of 1332), 732 leads stayed UNASSIGNED but the Import Queue showed "Nothing awaiting distribution." **Root cause:** `distributeBatch` incremented `distributedCount` by **`leadsSnap.size`** (ALL unassigned in the batch, 1332) instead of **`docs.length`** (the capped slice actually assigned, 600) — so the counter jumped to `successCount` and the queue's `successCount > distributedCount` filter read the batch as fully distributed, stranding the rest invisibly. Fixes:
- **`server.ts` `distributeBatch`**: `distributedCount: increment(docs.length)` (was `increment(leadsSnap.size)`) — counts only what this round actually assigned.
- **`ImportQueuePage`**: the queue now decides "awaiting" from a **LIVE `getCountFromServer` of still-UNASSIGNED leads per batch** (ground truth, immune to counter drift) rather than the stored counter; that live count also drives the card's "remaining" number. Counter is only a fallback while the live count loads / if the query is denied. (Uses the existing `leads(importBatchId, primaryOwnerId, deleted)` index.)
- **One-off data fix**: the stranded live batch `2026-06-29-EHS9` had `distributedCount` corrected 1332→**600** (= successCount − actual unassigned) so "sent" reads right and future rounds accumulate correctly. The 732 leftover now show in the queue to distribute in the next 100/agent round.
tsc + build clean; no rules/index change.

### Import — "Retry failed rows" in place (no re-upload, no duplicates) (2026-06-25) — ✅ DEPLOYED (rev `pulse-api-00076-zkb` + hosting, verify:deploy 3/3)
Re-uploading the whole sheet to recover a few fixed rows is wasteful + dupe-prone. New **`POST /api/import/retry-errors {jobId}`** (admin/manager/`crmCanImport`) re-processes ONLY the job's stored `errors[]`: reconstructs each row's cells, **re-applies phone salvage**, re-validates with the CURRENT logic, and imports the now-valid rows — **deduped against existing leads by `importHash`** so no duplicates — then rewrites the job's `errors`/`errorCount`/`successCount`/`status` (+ `retriedAt`). New leads land UNASSIGNED under the same batch → routed from the Import Queue. **Refactor (keeps retry in sync with the bulk import):** extracted **`validateCells(cells)`** (from `validateRow`) and **`writeImportedLead(batch, cells, ctx)`** (the per-lead write, pure move) in `server.ts`; both the chunk importer and retry call them. **UI**: the Import-History expanded error panel gained a **"Retry failed rows"** button (`useImportJobs.retryImportErrors` → the endpoint); the live history listener updates the counts, and a toast reports `imported / duplicates / stillFailing`. tsc + build clean; no rules/index change.
- **Follow-up (rev `pulse-api-00077-sfz` + hosting): retried leads were stranded.** They land UNASSIGNED under the SAME batch, but if that batch was already distributed (`distributed: true`) the **Import Queue** (which filtered `distributed !== true`) didn't show them → no way to assign. Fixed: (1) the queue now ALSO surfaces a batch when **`successCount > distributedCount`** (leftover unassigned), and the card shows the **remaining** count (`successCount − distributedCount`), not the total; (2) `distributeBatch` now **increments** `distributedCount` (`FieldValue.increment`) instead of overwriting, so re-distributing leftovers accumulates onto the original; (3) the `/api/import/distribute` 409 "already distributed" guard now blocks ONLY when nothing is unassigned (`successCount <= distributedCount`) — `distributeBatch` only ever touches UNASSIGNED leads, so re-running is safe. So retried rows now appear in the Import Queue to route like any import.

### Import — salvage a phone merged into the NAME cell (2026-06-25) — ✅ DEPLOYED (rev `pulse-api-00075-jrk`, verify:deploy 3/3)
A row like **"3M Car Care Gachibowli | 073373 93337"** with an EMPTY phone column was flagged "Phone is required" — the number was sitting inside the **name** cell (pipe-separated), not the mapped phone column. New **`salvagePhoneFromName`** in `server.ts`: when the mapped phone is blank/invalid, it scans the name for a phone-like token (`\+?\d[\d\s\-]{6,}\d`), and if `isImportablePhone` accepts it, uses it as the phone AND strips it (+ trailing `|,/–-`) from the name. Wired into `extractCells`, so **both the preview validation and the actual import** get the recovered phone + cleaned name. Gated by `isImportablePhone` so shop numbers/addresses (e.g. "Shop No 12-3-234") are NOT mistaken for phones (verified: salvages "…| 073373 93337" and "ABC Motors, 040-27951605"; leaves "Sri Ramdev Automobiles" and "Shop No 12-3-234" untouched). Server-only; tsc clean; no rules/index change.

### Import History — inline error detail + no horizontal scroll (2026-06-25) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3)
`ImportHistoryPage.tsx` had two complaints: (1) the 6 errors were download-only (CSV) — you couldn't SEE what failed; (2) the 9-column table sat in a `max-w-3xl` container → forced horizontal scroll even on a wide screen ("Started" wrapped to 3 lines). Fixes (presentation-only): the **red error count is now a click-to-expand toggle** (`ChevronDown/Up`) that opens an inline panel under the row listing each skipped row — **Row # · name · phone · reason** (red) — from the job's `errors[]` (the same data the CSV uses; "CSV" download kept). Container widened `max-w-3xl → max-w-6xl`, cell padding `px-4 → px-3`, `whitespace-nowrap` on the dense cells so the table fits without horizontal scroll on desktop (`overflow-x-auto` remains as a small-screen fallback). `tbody` rows wrapped in a `Fragment` (job row + optional expanded error row). tsc + build clean; no server/rules change.

### Import accepts landline numbers + preview sticky-header fix (2026-06-25) — ✅ DEPLOYED (rev `pulse-api-00074-sk5` + hosting, verify:deploy 3/3)
Importing a business contact list (auto-parts shops with Hyderabad `040-…` landlines) flagged **35/98 rows as errors** — `validateRow` in `server.ts` only accepted a 10-digit `^[6-9]\d{9}$` mobile, so every landline failed. Landlines are valid data. New **`isImportablePhone(raw)`**: strips non-digits + an optional `+91`/`91` + STD leading zero, then accepts a **mobile (10-digit 6-9) OR any plausible 8–12-digit landline** (e.g. `040-66320094`); only blank/garbage (`123`, `abc`) is rejected. Error message relaxed to "Phone must be a valid mobile or landline number". The phone-column **auto-detection** (`phoneHits`) now uses the same helper so a landline column is still detected. **Also fixed the import-preview glass-overlap** the user reported: `ImportPage.tsx:347` the **sticky** preview-table header used the translucent `--glass-panel-bg`, so scrolled rows bled through it (the "Sakshi Automobiles" row showing through the header) → switched to the **opaque `var(--ss-bg)`** (+ `zIndex 2`). tsc + build clean; no rules/index change.

### Import — multi-number cells + a clear duplicate count (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00080-lwm` + hosting, verify:deploy 3/3)
Two import improvements (no rules/index change):
- **A phone cell can hold MULTIPLE numbers** (`"9885299945, 9885012345"`) — previously the whole string failed validation ("Phone must be a valid mobile or landline number"). New `splitPhones(raw)` (split on `,` `/` `;` `&` newline → each validated by `isOnePhone`, the renamed single-number check) is used by `isImportablePhone` (cell OK if ≥1 valid number). `extractCells` returns the **first valid number as `phone`** + the rest as **`altPhones: string[]`**; `writeImportedLead` stores `altPhones` on the lead AND appends "Alt phone(s): …" to notes. The retry path re-splits too (recovers old multi-number rows stuck in errors[]). **`Lead.altPhones?: string[]`** added; **`LeadDetailPage`** shows each alt number with its own Call/WhatsApp `ContactActions` so agents can try every number.
- **Clear duplicate count.** Dups (intra-sheet + already-in-system) are now tracked in a separate **`ImportJob.duplicateCount`** — **out of `errorCount`/`errors[]`** (so "Errors" = genuine validation issues, and "Retry failed rows" only re-tries fixable rows). Status uses errorCount only (dups never make a job "failed"). **UI**: Import History gains a **"Duplicates"** column; the post-run summary shows a 4th **Duplicates** stat + a clear "N duplicates skipped — already in the system or repeated; only the first copy kept" note; the error breakdown now lists only real validation reasons.

### Import — friendly "this is an Excel file, not a Google Sheet" error (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00079-tzs`, verify:deploy 3/3)
Sharing an **uploaded `.xlsx`** Drive file (not a native Google Sheet) made Check-Access/preview/run surface the raw Sheets API error "This operation is not supported for this document. The document must not be an Office file." — cryptic. NOT a bug: the Sheets API only reads native Google Sheets. All three import endpoints (`/api/import/check`, `/preview`, `/run`) now detect `Office file` / `not supported for this document` and return a **400 with actionable text**: "This link is an uploaded Excel file, not a Google Sheet. In Google Drive, right-click it → Open with → Google Sheets, then File → Save as Google Sheets, and paste that new link here." (Fix is user-side — convert the file; no .xlsx-link support added.) tsc clean; server-only.

### Chunked assignment (cap per agent) + telecaller self-pull (2026-06-29) — ✅ DEPLOYED (rev `pulse-api-00078-qhc` + hosting, deploy:indexes + verify:deploy 3/3)
Distributing a big import by dumping ALL leads across agents at once was unmanageable. Two new ways to tag contacts ~100 at a time:
- **Manager — cap per agent.** `distributeBatch` gained a **`perAgentCap`** param (round-robin assigns at most `cap` to EACH selected agent; leftover stays UNASSIGNED and the batch re-surfaces in the Import Queue for the next round — reuses the `successCount > distributedCount` queue resurfacing). `distributedCount` already increments. `POST /api/import/distribute` reads `perAgent` (clamp 1–1000, 0/unset = all). **UI** (`ImportQueuePage` card): a **"Max per agent"** number input (default **100**) + the button shows how many go this round and how many stay (`Assign 300 leads to 3 agents (1200 stay in queue)`).
- **Telecaller — self-pull from the whole pool.** New **`POST /api/leads/pull {count?}`** (default 100, max 200): active **lead_convertor/lead_generator + managers/admins** claim the **oldest** unassigned imported leads (`primaryOwnerId == "UNASSIGNED"`, `deleted == false`, `orderBy createdAt asc`) to themselves — **race-safe** (each claim is a transaction re-checking the lead is still UNASSIGNED, so two pullers never grab the same contact), re-owns open opps + logs an activity, sets +24h SLA. **UI**: a **"Pull leads"** button (+count input, default 100) in **`MyQueuePage`** header (reached via **Tasks → My Queue**); the live `useMyLeads` listener shows them instantly. My Queue access broadened from generators-only to **all telecaller roles + managers/admins**.
- **Index**: new composite **`leads(primaryOwnerId ASC, deleted ASC, createdAt ASC)`** (oldest-first pull; the existing one was DESC). No rules change. tsc + build clean.

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
- `GET  /api/crm/team/performance?period=` — caller's OWN numbers (head) + agent-team summary (Phase P; head+coaching metrics 2026-07-01)
- `GET  /api/crm/team/all-teams?period=` — admin/SA: every manager's own numbers + agents + totals (2026-07-01)
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

**CRM — ops & audit**: `import_logs`, `import_jobs`, `access_requests`, `webhook_logs`, `lead_view_logs` (Phase M), `meta_lead_events` + `meta_lead_deadletters` (Meta webhook write-ahead store + dead-letters — server-only write, admin read), `rtbf_log`, `public_tracker_links`, `crm_documents`, `crm_tasks` (ad-hoc assigned to-dos — server-only write; assignee/creator/manager read; 2026-07-15)

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

### Leads page polish: received date/time · drop queue cards · stage dots · website/social = HIGH red (2026-06-22) — ✅ DEPLOYED (Cloud Run `pulse-api-00067-wvq` + hosting, verify:deploy 3/3 green)
CRM 2.0 Leads (`Crm2LeadsPage.tsx` + `QueuePanel.tsx` + `server/crm2.ts`), per Rahul:
- **Received date+time column** added to the leads table (`fmtTsFull(r.receivedAt)`, e.g. "22 Jun, 03:14 pm"); colSpans 7→8.
- **Removed the "Loans / SIP" queue-depth cards** from `QueuePanel` (they were noisy) — kept the **"Get next lead"** pull button, the "N waiting · M reps" summary, and the Active-reps panel. Dropped now-unused `Clock`/`AlertTriangle`/`fmtMs`.
- **Stage visibility**: each funnel chip now carries a **colored dot** in its `STATUS_META` stage colour (New blue · Attempted amber · Contacted green · Qualified gold · Converted green · terminal red/grey), so the contact stages read at a glance alongside the per-row coloured status badge.
- **Website + social leads = HIGH (red) priority.** `HOT_SOURCES = {WEBSITE, ADS}` → the row priority dot is forced **red** and a red **HIGH** pill shows next to the source. Server: public-website (`source:WEBSITE`) + Meta (`source:ADS`) lead creates now store **`priority:"HOT"`** (was WARM) so queue/SLA/sort treat them as high too. Existing leads get the red display via `HOT_SOURCES` regardless of stored priority.
- **Follow-up shows date + time** (2026-06-22 follow-up): the leads-list Follow-up column now renders `fmtTsFull` (date **and** time) instead of date-only — the drawer picker was already `datetime-local`, so the time was captured but not displayed. Dropped the now-unused `fmtTs` helper.
tsc + `build:prod` clean.

### CRM/Leads employee-friendliness — Tier 1 wording/clarity pass (2026-06-24) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Plain-words UX audit of CRM 2.0 Leads + 10-stage Cases + Masters (report: `~/.claude/plans/melodic-roaming-sloth.md`). **Presentation-only — no logic, no stage change, no stored-value/field-name change.** Tier 1 (quick wins) shipped:
- **NEW `src/features/crm2/labels.ts`** — single source of truth for friendly display wording (keys off the stored enum, falls back to title-case via `humanize`): `SOURCE_LABEL`/`sourceLabel`, `CATEGORY_LABEL`/`categoryLabel`, `PAYOUT_STATUS_LABEL`/`payoutStatusLabel`. **Stored values unchanged** (`HOT`, `WALKIN`, `AWAITING_DATA_SHARE`, `connectorId`, …).
- **Leads** (`Crm2LeadsPage`): source/category dropdowns + table now read human ("Walk-in", "Social Ad", "Referral (Connector)", "Partner Sign-up", "CIBIL Check"); the red **HIGH** badge gained a tooltip ("website/social — contact fast"); Entity-vs-Customer hint added; **Release-to-queue** promoted from a tiny red link to a bordered button with a tooltip.
- **Payout status** wording centralised: `PayoutTab.CYCLE_STATUS_LABEL` now re-exports `PAYOUT_STATUS_LABEL` (one source); the case header "Payout: …" badge reads human (e.g. "Awaiting data share", "Paid to partner", "Not due yet") instead of raw ALL_CAPS.
- **Disburse dialog** (`LoginsSection`): killed the "Connector" collision — the SDSA slab leg → **"Sub-DSA payout % (override)"**, the FAC-/CON- sourcing partner → **"Connector payout (sourcing partner) — <name>"**. "Verified App No" → "Verified Application No" + placeholder hint.
- **File-Login docs-sent gate honest**: the "Save & advance" button is now disabled with a tooltip + reads "Tick 'Docs sent' to advance" until the box is ticked (was a late error after clicking).
- tsc + `build:prod` clean. Emulator gates untouched (no server/logic change). **Tier 2/3** (legacy-list relabel, case-vs-login divider, field grouping, sub-process labels) remain in the report for later.

#### Tier 2 — light structure (2026-06-24) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Still presentation-only. (1) **Old Customers page** (`crm/leads/LeadsPage`) header → "Customers **Legacy**" pill + a one-line "being phased into Leads — mark Interested to move across" note. (2) **Case workspace** (`CaseWorkspacePage`): the stages-4–9 note became a clear **"Per-bank files · stages 4–9"** divider heading + a plainer explainer, so the jump from one case form to a list of bank cards is expected. (3) **Login form** (`LoginsSection`): a prominent **"Stage N · Working/Viewing/New login: <label>"** header banner at the top (new `STAGE_NUM` map 4–10) replaces the faint intro line. (4) **New-Lead form** (`Crm2LeadsPage`): an **"Optional details"** divider before the Product/Amount/Assign/Connector block so the required fields read as the essentials. tsc + build clean; no server/rules/index change.

#### Tier 3 — polish (2026-06-24) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Final presentation-only polish. (1) **Masters page**: a plain-words **"How it fits together"** helper strip — Aggregator → Lender → Product → Sub-Product → DSA code + payout; Connector = who referred the customer. (2) **Login form** (`LoginsSection`): expanded the terse sub-process labels (Technical → **Technical Assessment**, Valuation → **Property Valuation**, Legal → **Legal Check**, Credit → **Credit Appraisal**); the BT & Secured conditional fields are now **visually nested** (gold left border + tint) so they read as belonging to their checkbox. (3) **Lead status** `Junk/Dup` → **"Junk / Duplicate"** (label only). _Note: the query log already shows in view mode (`isEdit = !!login`), so no change needed there. A TRUE split of Junk vs Duplicate into two stored statuses would need a backend enum change — flagged, NOT done (kept presentation-only)._ tsc + build clean; no server/rules/index change. **CRM/Leads employee-friendliness Tiers 1–3 are all live.**

### Product gains a lead Category — filters the product picker when adding a lead (2026-06-23) — ✅ DEPLOYED TO PRODUCTION (rev `pulse-api-00073-5vf`, Cloud Run + hosting, verify:deploy 3/3 green)
Agents adding a lead saw **every** product in the picker (confusing). Added a **`category` to the Product master** (reuses the lead-category enum: LOAN/WEALTH/INSURANCE/CIBIL_CHECK/PARTNER_DSA/GENERAL) so the product list **filters by the selected lead Category**.
- **Type** `Product.category: Crm2LeadCategory | null` (additive). Server `sanitizeProduct` accepts it (enum-validated, else null). No rules/index change (existing collection).
- **Masters → Products**: new **"Lead Category"** select (+ a Category column). Editable per product.
- **Lead add** (`Crm2LeadsPage` NewLeadModal): the Product picker now shows only products whose `category` matches the selected **Category** (uncategorised products show for all — legacy-safe); changing Category clears a stale product. Same filter on the **Convert** wizard's product picker (by the lead's category) and the old-CRM **Customer→Lead promote** dialog (`LeadDetailPage` PromoteToLeadDialog). Helper `filterProductsByCat` + `ProductOpt` type (option carries `cat`). The product flows convert → case → per-login work.
- The walk-in case-open product picker (`Crm2CasesPage` NewCaseModal) is left unfiltered (no lead category context). Gates green (phase1 13). tsc clean. **Setup**: set each product's Lead Category in Masters → Products so the lead picker narrows.

### Sub Product is now its OWN master entity (2026-06-23) — ✅ DEPLOYED TO PRODUCTION (rev `pulse-api-00072-gp5`, deploy:rules + Cloud Run + hosting, verify:deploy 3/3 green)
Final model (supersedes both same-day entries below): **Sub Product is a first-class master** (a tab like Connectors/Lenders/Products/Aggregators/DSA Codes/Documents) — just a **name mapped to a Product**. Chain: **SubProduct → Product → Lender → DSA Codes**. (Trial setup; Rahul will bulk-import 100+ from a sheet later — the collection + generic create endpoint already support that.)
- **New collection `subProducts/{SUBP-###}`** + type `SubProduct { name; productId; status }` (`src/types/crm2.ts`). Server: `sanitizeSubProduct` + MASTERS entry (`subProducts`, prefix `SUBP-`) — created/edited via the existing generic `POST/PATCH /api/crm2/masters/subProducts`. **Rules**: new `match /subProducts/{id}` (read = admin || any crm2 read; write = false, server-only) — `deploy:rules` (ruleset `3d55a32c…`). No new index (whole-collection load).
- **Masters UI**: new **"Sub Products"** tab (`MastersPage`, `Layers` icon) — fields Name + Product (select) + Status; column shows the mapped product.
- **DSA Codes create form** (`MappingsTab`): the **Product picker is now scoped to the selected lender's `productsOffered`** (enforces Lender→Product; falls back to all if none set), and the **sub-product payout rows come from the `subProducts` master** (filtered to the product, ACTIVE) — not the lender or the product's old field. Resets product+payout on lender change.
- **Case Details** sub-product picker reads the `subProducts` master (scoped to the case's product); `subProducts` loaded into `CaseWorkspacePage` (gated to Details view). Login DSA preview unchanged (matches on the case's chosen sub-product string).
- **Reverted** the prior same-day `Lender.lenderSubProducts` (type + sanitizeLender handling + Lender form editor removed). `Product.subProducts` kept in the type as LEGACY (no editor). Gates green (phase1 **13/13** incl. a new SUBP- mint+map assertion · phase4-money 13 · phase5 12). tsc clean.

### Sub-products are LENDER-specific (per product) — moved off the product (2026-06-23) — ⚠️ SUPERSEDED same day by the Sub Product master entity (see entry above)
Correction to the prior entry: sub-products belong to a **lender** (per product), not a global list on the product — e.g. "Pragati" / "Pragati Ashiyana HL" are Aditya Birla Capital's HML sub-products; another lender's product has different ones. The DSA-code payout form was showing the product's whole list (incl. other lenders' sub-products like "Affordable Housing"). Now only the **selected lender's** sub-products for the selected product show.
- **Type**: new **`Lender.lenderSubProducts: Array<{ productId; subProduct }>`** (additive). `Product.subProducts` kept in the type for back-compat but **its editor + the products table column were removed** (it was the wrong place — last session's misread). Server `sanitizeLender` accepts/sanitizes `lenderSubProducts` (filters blank rows); defaults `[]` on create. No rules/index change.
- **Lenders master**: new **"Sub-products (per product)"** rows editor (Product select + Sub-product text) — define each sub-product THIS lender offers per product.
- **DSA Codes create form** (`MappingsTab`): the payout-per-sub-product rows now come from **`selectedLender.lenderSubProducts` filtered to the selected product** (strict — never the global product list); payout resets on lender OR product change; messaging updated.
- **Case Details** sub-product picker now reads the **case's lender's** sub-products for the product (dropped the products-master dependency + its load in `CaseWorkspacePage`).
- **Login DSA-code preview** (`LoginsSection.resolvedMapping`) made deterministic + sub-product-aware (mirrors the server's `resolveMapping`: product×subProduct → product whole → any product → legacy → pair); `caseSubProduct` threaded CaseWorkspacePage → LoginsSection → LoginFormModal.
- Server disburse `resolveMapping` already keys on `case.subProduct` (prior session) — unchanged; the sub-product STRING is what matches, so lender-sourced options stay consistent. Gates green (phase1 12 · phase4-money 13). tsc clean. **Migration note**: existing sub-products entered on Products no longer drive the form — re-enter them per lender under Lenders → Sub-products.

### Sub-products: explicit "Add sub-product" editor in the Products master (2026-06-23) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green) — _superseded same day; sub-products moved to the Lender (see entry above)_
Sub-products were a comma-separated `taglist` buried in the Product form — easy to miss. Made adding them an **explicit option**: a generic-form **`kind: 'stringlist'`** field (`StringListEditor` in `MastersPage.tsx` — one input per item, add/remove rows, custom `addLabel`). The Product's `subProducts` field now uses it (`addLabel: 'Add sub-product'`, placeholder "e.g. Prime LAP"), with a hint that sub-products appear in **DSA Codes** so each can be mapped to a **lender + aggregator** with its own DSA code + payout (the product/sub-product × lender × aggregator linkage was built the prior session). Wired `stringlist` through the form (init/required/submit) + `fmtDetailValue`. **Pure frontend** — the server product sanitizer already stores `subProducts` as a `string[]` (`strArr`); no server/rules/index change. tsc clean.

### "Slab" → "Payout"; payout entered per product / per sub-product (2026-06-22) — ✅ DEPLOYED TO PRODUCTION (rev `pulse-api-00069-vk7`, Cloud Run + hosting, verify:deploy 3/3 green)
Per Rahul: "there is nothing called slab — change it to payout"; and the payout is **specific to a product, and to a sub-product when one exists** (e.g. LAP 1.44%, LAP·Prime LAP 1.55%). Built on top of the per-product mapping (above) — the mapping is already keyed by (aggregator, lender, product, subProduct), so each carries its own DSA code + payout.
- **"Slab" → "Payout" (UI only)** in `MappingsTab.tsx` — all user-facing strings (column "Payouts", "Payout timeline", "Add Payout", "End Payout", overlap/immutability notes). Code identifiers (`MappingSlab`, `slabId`, `findSlabOverlaps`, the `/slabs` endpoints) are unchanged.
- **Create-Mapping form is now payout-per-sub-product** (`CreateMappingModal`): pick aggregator/lender/product/DSA code → a **Payout %** section driven by the product: **no sub-products → ONE payout field** (whole product); **has sub-products → a payout % row per sub-product** (+ an optional whole-product fallback row). On submit it creates **one mapping per filled row** (each keyed by its `subProduct`) with an open-ended initial payout (`effectiveFrom` today). The standalone sub-product picker + the "add slab later" step are gone. The editor's **Add Payout** form dropped the free product multi-select (a mapping is for ONE product — its payout) and shows "Payout for <product · subProduct>".
- **Case carries a sub-product** so disburse picks the right payout: new **`Crm2Case.subProduct: string | null`** (additive); server case-open defaults it (manual = from body, convert = null); added to `CASE_EDITABLE_FIELDS`. Case **Details tab** shows a **Sub-product picker** (only when the product has sub-products) → `PATCH {subProduct}`. `products` master loaded into `CaseWorkspacePage` (gated to the Details view).
- **`resolveMapping` is sub-product aware + deterministic**: precedence (agg × lender × product × **subProduct**) → (product, whole) → any product mapping → legacy product-less. Never picks an arbitrary sub-product, so disburse uses the case's sub-product payout when set, else the whole-product payout. All 4 disburse/preview lookups pass `c.subProduct`. Money math unchanged. **No new index** (the `(connectorId, lenderId, productId)` composite covers the product query).
- Emulator gates green (phase1 12 · phase4 24 · phase4-money 13 · phase5 12 — whole-product path + no regression; sub-product preference is deterministic logic). tsc clean (client + server).

### DSA Code Mapping keyed by aggregator × lender × PRODUCT (+ optional sub-product) (2026-06-22) — ✅ DEPLOYED TO PRODUCTION (rev `pulse-api-00068-fr5`, deploy:indexes + Cloud Run + hosting, verify:deploy 3/3 green)
The DSA-code mapping (`/dsaCodeMappings`, "DSA Codes" master tab) was keyed only by **aggregator × lender** with one mapping per pair and `codeRegisteredName` mandatory — but DSA codes are issued **per product** (and sometimes per sub-product). Reworked the correlation: a mapping is now **aggregator × lender × product** (optionally **× sub-product**), `codeRegisteredName` is **OPTIONAL**, and the stale "connector × lender" wording → "aggregator × lender × product".
- **Type** (`DsaCodeMapping`): added `productId: string` + `subProduct: string | null`; `codeRegisteredName` → `string | null` (optional). Slabs unchanged (per-product payout % still live in date-ranged slabs within the mapping).
- **Server** (`server/crm2.ts`): `POST /api/crm2/mappings` now requires `productId`, accepts optional `subProduct`, `codeRegisteredName` optional; **uniqueness is (connectorId, lenderId, productId, subProduct)** — multiple mappings per aggregator×lender now allowed (one per product/sub-product), 409 only on an exact-grain clash. PATCH `codeRegisteredName` optional. New **`resolveMapping(connectorId, lenderId, productId?)`** helper: prefers the per-product mapping, falls back to a **legacy product-less** mapping so pre-existing rows keep working; the **4 disburse/preview lookups** (per-case + per-login × disburse + preview) now use it with the case's `productId`. Money math (slab resolution, freeze, cycle/MIS) unchanged.
- **Index**: new `dsaCodeMappings(connectorId ASC, lenderId ASC, productId ASC)` (deployed READY) — backs the uniqueness query + `resolveMapping`'s exact lookup.
- **UI** (`MappingsTab.tsx`): Add-Mapping form gains a **Product** picker (required) + **Sub-product** picker (optional, populated from the chosen `Product.subProducts`); "Code Registered Name" relabelled optional (no required validation, sends `null` when blank); new **Product** column in the table (`shortCode · sub-product`); note → "one mapping per aggregator × lender × product (optionally × sub-product)". The login DSA-code preview (`LoginsSection` `resolvedMapping`) is now **product-aware** (prefers the case's product mapping, legacy fallback) — `caseProductId` threaded CaseWorkspacePage → LoginsSection → LoginFormModal.
- **Gates updated** (the FILE_LOGIN→next advance now requires `docsSent` from an earlier-this-session gate, which had left the login gates red — their setups never set it): all 6 login-advance loops across phase4/phase4-money/phase5 now PATCH `docsSent: true` first; all 5 mapping-create payloads pass `productId`; phase1's stale `CONN-` assertion → `AGG-`. Emulator gates green: **phase1 12/12 · phase4 24/24 · phase4-money 13/13 · phase5 12/12** (`.qa/_gate-inner.sh` = generic runner inside `firebase emulators:exec`). tsc clean (client + server).

### CRM 2.0 Cases page scoped by role — same as leads (2026-06-22) — ✅ DEPLOYED (deploy:indexes + hosting, verify:deploy 3/3 green)
Applied the leads scoping to the **Pipeline Cases** list (`Crm2CasesPage.tsx`). New **`useScopedCases(seesAll, myFapl)`** hook: **managers / super-admins see ALL cases**; everyone else sees only cases they **handle (`handlingRm == own FAPL`)** OR are a **collaborator on (Phase 6, `collaborators array-contains own FAPL`)** — two live queries merged + deduped + sorted by `updatedAt`. Header subtitle for non-managers reads "Showing cases assigned to you or shared with you." Two new composite indexes (deployed READY): **`cases(handlingRm ASC, updatedAt DESC)`** + **`cases(collaborators ARRAY_CONTAINS, updatedAt DESC)`**. _Same caveat as leads: UI/query-level scoping; the cases read rule still permits `crm.cases.read` broadly (rule-hardening is the follow-up)._ tsc + `build:prod` clean. No server/rules change.

### CRM 2.0 Leads page scoped by role — telecallers see only their assigned leads (2026-06-22) — ✅ DEPLOYED (deploy:indexes + hosting, verify:deploy 3/3 green)
The Pipeline Leads list read **all** leads for any `crm.leads.read` holder, so telecallers could see/mess with confirmed website contacts. Now `useCrm2Leads(scopeFapl)` scopes the live query: **managers / super-admins (`isManager || isSuperAdmin`) see ALL leads** (to assign); **everyone else sees only `assignedRm == own FAPL`** (`profile.employeeId`; falls back to a `__none__` sentinel that matches nothing if the user has no FAPL). Telecallers get leads via **"Get next lead"** (queue claim → assigns to them) or a **manager assigning** via the drawer's Assign-RM; the header subtitle for them reads "Showing leads assigned to you…". New composite index **`leads(assignedRm ASC, receivedAt DESC)`** (deployed READY) backs the scoped query. _Scope: UI/query-level — the leads read **rule** still permits `crm.leads.read` broadly, so a determined non-manager could still query outside the app; server-rule hardening is the follow-up. The Customers/old-CRM page is unaffected (separate query)._ tsc + `build:prod` clean. No server/rules change.

### Manager gets a bell+email when their report requests leave/claim (2026-06-22) — ✅ DEPLOYED (Cloud Run `pulse-api-00066-pkm` + hosting, verify:deploy 3/3 green)
Was **never coded** — leave/claim notifications only fired on approve/reject, nobody was alerted on *request*, and a regular employee can't call the admin/HR-only `/api/hrms/notify/email` nor write a manager's `/notifications` doc (rules block both). New path:
- **`POST /api/hrms/notify/manager`** (`server.ts`, any signed-in employee) — the server reads the **caller's** `users/{uid}.reportingManagerUid` (client can't spoof it), then writes an in-app bell to the manager's `/notifications/{mgr}/items` (Admin SDK, bypasses the create rule) + sends a branded email (`buildBrandEmail` + `sendGmailMessage`). No-op (`skipped:"no_manager"`) when the employee has no reporting manager. Body: `{ kind:'leave'|'claim', title?, intro?, rows[], link? }` — heading defaults to "`<empName>` — leave/claim request".
- **Client helper `notifyManagerOfRequest`** (`src/lib/notifications.ts`, fire-and-forget) wired into **`ApplyLeavePage`** (after `applyForLeave` → rows: type/dates/days/reason, link `/hrms/admin/leave`) and **`ClaimsPage`** (after `submitClaim` → type/amount/description/route, link `/hrms/admin/claims`).
- New `NotificationType` values **`leave_request`/`claim_request`** added to both unions (`lib/notifications.ts` + `types/index.ts`) and to `NotificationBell` `TYPE_META` (🌴/🧾). So a manager (e.g. Rahul over Kalyan) now gets the bell + email the moment their report applies. _Scope: notifies the reporting manager only (not HR) — flag if HR should also be alerted on request._ tsc + `build:prod` clean.

### Login Code+Login: drop Code Name, auto-resolve DSA code from the mapping master (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Follow-up on the Code + Login stage (`LoginsSection.tsx` only):
- **Removed the "Code Name" free-text field** + the helper hint line under the aggregator picker (the `codeName` field stays in type/server, just unrendered).
- **DSA code now auto-resolves from the completed master mapping.** The modal loads `dsaCodeMappings` (`useCrm2Collection`, passed into `LoginFormModal`); when "Aggregator code" + an aggregator is picked, it finds the mapping where `connectorId === aggregator && lenderId === the login's lender` (prefers ACTIVE) and shows **DSA code: `<dsaCode>` · from mapping `<aggregator> × <lender>`** (e.g. RA050 for RU Loans × SMFG). If no mapping exists → an amber "add it in Masters → DSA Codes" note. Display-only (the authoritative freeze still happens at disburse via `resolveSlab`); no persisted/`connectorId`/payout change. tsc + `build:prod` clean.

### Login "DSA Code Used" → Finvastra's code or an Aggregator (picked from the master) (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00065-djc` + hosting, verify:deploy 3/3 green)
On the per-login **Code + Login** stage, the "DSA Code Used" dropdown's second option **"Connector's own code" → "Aggregator code"**, and choosing it reveals an **Aggregator picker sourced from Pipeline → Masters → Aggregators** (e.g. *RU Loans · AGG-001*) so the file's code-source syncs with the master.
- **Type** (`types/crm2.ts`): new `Login.dsaAggregatorId: string | null` (the aggregators-master id when `dsaCodeUsed==='connector_own'`). `dsaCodeUsed` enum value unchanged (relabel only).
- **Server** (`server/crm2.ts`): `dsaAggregatorId` added to `LOGIN_EDITABLE`.
- **UI** (`LoginsSection.tsx`): the modal now loads the **aggregators** master (`useCrm2Collection('aggregators')`, passed into `LoginFormModal`); the picker lists active aggregators by `name · id`, **defaults to the case's `connectorId` aggregator** (smooth sync), and `dsaAggregatorId` is only persisted when "Aggregator code" is selected (cleared otherwise). Attribution only — no payout-math/`connectorId` change. tsc + `build:prod` clean.

### Per-login: click-a-stage to work it (remove Edit; view past / edit current / lock future; confirm-to-advance) (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Reworked the per-login interaction (`LoginsSection.tsx` only — server/types unchanged), per Rahul:
- **Edit + Advance buttons removed** from the login card. The card keeps **Record Disbursement** (SANCTIONED→DISBURSED money engine) + **Reject** (early close), plus a hint "Click the current stage on the line to work it →".
- **The stage dots on the green rail are now the entry point.** Click a **past** stage → opens it **read-only** (view); click the **current** stage (writers only) → opens an **editable** form for just that stage; **future** stages are not clickable (dimmed, disabled). Non-writers can still view any reached stage.
- **`LoginFormModal` rebuilt to work ONE stage** (`focusStage` + `readOnly` props) instead of the cumulative all-stages form: renders only that stage's section; read-only mode wraps the body in `pointer-events-none`. (Add Login = create at File Login.)
- **Save → confirm second screen → advance.** Editing the current stage shows **"Save"** (patch only) + **"Save & advance to <next>"**; the latter opens a confirmation panel ("Move from <stage> to <next>? Make sure every detail is entered — once advanced this stage is view-only") → on confirm it patches the fields then advances. **SANCTIONED** is save-only (disburse via Record Disbursement); **FILE_LOGIN** advance still requires `docsSent` (client check + server 422). Uses the existing login PATCH + stage endpoints — no logic/server change.
tsc + `build:prod` clean. `Pencil`/`ArrowRight` imports dropped.

### Per-login progress line: stage names under each dot (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
The per-login green progress rail on each login card (`LoginsSection.tsx`) was bare dots + "Step N/7" (stage name only on hover). Restructured to show the **stage name under each dot** (File Login · Code + Login · In Process · Sanctioned · Disbursed · PDD / OTC · Completed) — flex-col dot+label with green connectors (done = green #34d399, current = gold), `overflow-x-auto`, "Step N/7" still on the right. (The case-level stepper already labelled its circles.) Pure UI. tsc + `build:prod` clean.

### Case stepper: green progress rail + Close-on-right / tabs-on-left (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Case workspace header layout, per Rahul (`CaseWorkspacePage.tsx` only — no logic change):
- **Green progress rail on the 10-stage case stepper.** Desktop chips now have a connecting line that **turns green (#34d399) as each case stage completes** (like the per-login cards); done circles are green, the current stage gold, future grey. Mobile vertical timeline matched (green done circles + green connector). Stage-click/`setView` behaviour unchanged.
- **Close button moved to the RIGHT; glance tabs moved into its old spot (left).** The Details / Collaboration / Client-ID data / History tabs and the "Close (reject/withdraw)" button now share one `justify-between` row at the bottom of the stepper panel — tabs left, Close right (was: Close left, tabs in a separate row below). Same handlers (`setView`, early-close `advance('CLOSED', …)`); the separate tabs row was removed.
tsc + `build:prod` clean.

### Login form: opaque header · SM/ASM email + manager-only · docs-sent channel + advance gate (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00064-tvr` + hosting, verify:deploy 3/3 green)
Five fixes on the case Login form (`LoginsSection.tsx` + `types/crm2.ts` + `server/crm2.ts`):
- **Transparent header fixed** — the shared `Modal`'s sticky `glass-modal-header` was translucent so the scrolled intro note bled through under the title. Gave it an **opaque `var(--ss-bg)` background + bottom border**.
- **SM/ASM emails added** — new `Login.smEmail` / `asmEmail` (+ `LOGIN_EDITABLE`). The form's **Bank Contacts** block now has SM Name/Number/**Email** + ASM Name/Number/**Email**.
- **SM/ASM are manager-only** — the whole bank-contacts block in the form AND the **SM chip on the login card** now render only when `canSeeBankContacts = role==='admin' || crmRole==='manager' || isSuperAdmin` (hidden from telecallers/RMs; "restricted to managers" note shown otherwise). _⚠️ Note: the separate **LenderInfo** panel (lender-master contacts, made visible to all case viewers last session) was left as-is — flag if it should be gated too for consistency._
- **"Direct from bank (bank pays Finvastra)" checkbox removed** from the form (field kept in type/server, just unrendered).
- **"Docs sent to bank" → channel sub-option** — new `Login.docsSentVia: 'email'|'whatsapp'|null` (+ `LOGIN_EDITABLE`); when "Docs sent" is ticked, an **Email | WhatsApp** pill ticker appears. **Advance gate**: a login can't move forward out of **FILE_LOGIN** until `docsSent===true` — enforced server-side in the stage endpoint (422 "Confirm 'Docs sent to bank'…", early-close to COMPLETED still allowed) AND client-side (the card's "Advance →" becomes a "Confirm docs sent to advance" chip).
tsc + `build:prod` clean.

### Login form: stage-gated sections (each stage's fields show only when reached) (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Follow-up to the unified login form — Rahul: showing every stage's fields at once is wrong; show fields per the login's **respective stage**. `LoginFormModal` (`LoginsSection.tsx`) now gates each section by the login's current stage (`stageIdx = LOGIN_STAGE_ORDER.indexOf(login?.stage ?? 'FILE_LOGIN')`): ① File/Bank Login always; ② Code+Login (stageIdx≥1); ③ In Process (≥2); ④ Sanctioned (≥3); ⑤ Disbursement extras BT/Secured (≥4); ⑥ PDD/OTC (≥5). So a **fresh login (Add) shows ONLY ① File/Bank Login** (bank/branch/amount + SM/ASM + docs); later stages' fields appear as the login advances via "Advance →" on the card. Cumulative (you can still edit stages already reached, not future ones). Intro note now shows "Currently at <stage>…". Applicants + Remarks stay always-visible. Pure UI gate — no logic/server/rules change. tsc + `build:prod` clean.

### Login form: ONE add/edit form + branch autocomplete + amount commas/words (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Case → Logins UX, per Rahul. `LoginsSection.tsx` only (+ new util):
- **Add Login and Edit Login are now ONE form** (`LoginFormModal`, `login===null`⇒add). The old minimal Add (bank/branch/amount) is replaced by the full form — bank/branch/amount + SM/ASM + every stage's fields in one place, so there's no "add then edit to add RM/SM". On **add** it POSTs to open the login then PATCHes all entered details in a single Save (`Open Login`); on **edit** it PATCHes (`Save Changes`). The query-log raise/resolve (which needs a login id) shows in **edit mode only**. The standalone `AddLoginModal`/`EditLoginModal` were merged.
- **Branch autocomplete** (`BranchInput`): a free-text input backed by a `<datalist>` of the **selected lender's known branches** (deduped from its SM/ASM `contacts[].branch`) — so the branch auto-suggests like the bank does, while still allowing a typed value. _(No branches master exists; suggestions come from the lender's contacts.)_
- **Amount commas + words** (`AmountInput` + new **`src/lib/numberToWords.ts`** — `formatIndianNumber` Indian grouping, `digitsOnly`, `amountInWords` lakh/crore). Amount Requested + Sanctioned show **3,00,00,000** grouping as you type and a **"≈ Three Crore Rupees"** line below. (Reuses the same algorithm as the HR letter generator's `ctcToWords`.)
- No server/rules/index change (the login POST/PATCH endpoints already accept all these fields). tsc + `build:prod` clean.

### Connector master: rich record (entity type · PAN/Aadhaar · payout bank · TDS · multi-mobile) + code CON- (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00063-rh7` + hosting, verify:deploy 3/3 green)
The Masters → Connectors record was expanded into a full DSA master, with proper encryption. **Connector code is now `CON-###`** (Rahul's choice this round; was FAC- then CONN-).
- **New fields** (`Connector` in `types/index.ts`): `entityType` (the **Client-master constitution options** — INDIVIDUAL/PROPRIETORSHIP/PARTNERSHIP/LLP/PVT_LTD/HUF), `mobiles: string[]` (multi-mobile; `mobile` kept = `mobiles[0]` for the pickers), `gstin?`. Sensitive financial moved to the admin/HR-only **`/connectors/{id}/private/financial`** sub-doc (`ConnectorFinancial`): **`panEnc`** (AES-256-GCM) + `panLast4`, **`aadhaarLast4`** (last-4 ONLY — full Aadhaar never stored, UIDAI/`rejectFullAadhaar`), **`payoutBank`** { bankName, accountHolderName, ifsc, **`accountNoEnc`** + `accountNoLast4`, branchName }, **`tdsPct`**.
- **Create/edit now go through the SERVER** (encryption key is server-only): new **`POST /api/crm2/connectors`** + **`PATCH /api/crm2/connectors/:id`** (perm `crm.masters.write`) — validate + encrypt PAN (required on create) & account no, reject full Aadhaar, mint `CON-###` (`nextConnectorCodeServer`, counts FAC-/CONN-/CON-), write main doc + private financial. The lean client writers (`addMasterConnector`/`updateMasterConnector`) were removed from `useConnectors.ts`; **`getConnectorFinancial`** re-added (super-admin/admin reads the private doc client-side for the edit dialog's last-4 hints). Status toggle stays client-side.
- **Form** (`ConnectorFormModal`): name + entity type, **multi-mobile with a "+ Add another mobile"**, email/firm, verticals, **KYC** (PAN required w/ "current ••••1234 — blank keeps it" on edit; Aadhaar last-4; GSTIN optional), **Payout Account** (bank name, name-as-per-account, account no [last-4 hint], IFSC, branch, TDS%), status. List gains an **Entity Type** column + a `+N` mobile-count hint.
- **Code migration updated**: `POST /api/crm2/admin/migrate-connector-codes` now renames **FAC-/CONN- → CON-** (+ repoints denormalised `channelPartnerCode`); the Connectors-tab banner reads "Rename to CON-". **Maintainer action: Masters → Connectors → click "Rename to CON-" once** (covers the existing CONN-/FAC- code).
- **Compliance note (flagged to Rahul):** Aadhaar is stored as **last-4 only** — the full 12-digit number is never persisted (UIDAI). PAN + bank account are encrypted; only last-4 ever displayed. Financial lives in the admin/HR-only private sub-doc, so CRM telecallers (who read `/connectors` for the picker) never see PAN/bank. No rules/index change (the `/connectors/{id}/private` block already exists). tsc + `build:prod` clean.

### Masters: connector codes FAC- → CONN-; Edit pencil removed from list rows (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00062-bpp` + hosting, verify:deploy 3/3 green)
Follow-up to the AGG- rename — with CONN- freed from aggregators, connectors take it:
- **Connector codes `FAC-###` → `CONN-###`.** `nextConnectorCode` (`useConnectors.ts`) now mints **CONN-** (counts both FAC-/CONN- for the max so numbers never collide). `connectorCode` is a display FIELD (the real link is the connector doc id / `channelPartnerId`), so new **`POST /api/crm2/admin/migrate-connector-codes`** (perm `crm.masters.write`, idempotent) rewrites each FAC- connector's `connectorCode` → CONN- **and** repoints the denormalised `channelPartnerCode` on `leads`/`cases`/`logins`. A **"Rename to CONN-" banner** shows on the Masters → Connectors tab while any FAC- code remains. **Maintainer action: Masters → Connectors → click "Rename to CONN-" once.**
- **Edit pencil removed from all Masters list rows.** Now that rows are click-to-open (prev change), the per-row pencil is gone: generic `MasterTab` dropped its action column (colSpan 4→3; edit is the **Edit** button inside the `MasterDetailModal`); the **Connectors** tab dropped its pencil too (row click opens the editable form; **Activate/Deactivate** quick-action kept). `Pencil` import still used by the detail dialog.
tsc + `build:prod` clean. No rules/index change.

### Masters: clickable row → detail popup + aggregator IDs CONN- → AGG- (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00061-tvh` + hosting, verify:deploy 3/3 green)
Two asks on Pipeline Masters:
- **Click any master row → read-only detail popup** (`MastersPage.tsx`): new **`MasterDetailModal`** + `fmtDetailValue` (renders every field-def value: select→label, multiselect/taglist→joined, `rows`→mini-table, date→formatted). Generic `MasterTab` rows are now clickable (`cursor-pointer`, hover) → opens the detail showing everything entered, with an **Edit** button inside that switches to the form; the row's Edit pencil + Connectors row actions `stopPropagation`. The **Connectors** tab row opens its form modal (shows all entered fields). Covers Lenders/Products/Aggregators/Documents + Connectors.
- **Aggregator IDs were `CONN-###`, now `AGG-###`.** Root cause: aggregators were historically minted with a `CONN-` prefix (PLAN decision E; field name stays `connectorId`). Fixed the mint prefix in `server/crm2.ts` `MASTERS.aggregators` (`CONN-` → **`AGG-`**) so new ones are AGG-. For the existing `CONN-001` (RU Loans): new **`POST /api/crm2/admin/migrate-aggregator-ids`** (perm `crm.masters.write`, idempotent, reference-safe) — copies each `CONN-#` aggregator to `AGG-#`, repoints every `connectorId` reference (`dsaCodeMappings`, `cases`, each case's `logins` subcollection, `misRecords`, `payoutCycles`), then deletes the old doc; the counter is untouched (already reflects the count, so the next mint won't collide). UI: an **`AggregatorMigrationBanner`** on the Aggregators tab shows a "Rename to AGG-" button only while a `CONN-` aggregator still exists. **Maintainer action: open Masters → Aggregators → click "Rename to AGG-" once** to convert the live CONN-001.
tsc + `build:prod` clean. No rules/index change.

### Lenders master: super-admin-only Masters + bank details visible in the case (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
The Lender master already captured rich data (type, products, `loginEmail`, `tatBenchmarkDays`, `contacts[]` of SM/ASM/RM with mobile/email/branch) but it was buried in the edit form and invisible to RMs working a case. Three changes (frontend-only):
- **Bank details now visible inside the Case** (`LoginsSection.tsx`): new read-only **`LenderInfo`** panel on each login card — a collapsible "🏦 Bank contacts & details" `<details>` showing the lender's type, TAT, login email (mailto), and the SM/ASM/RM **contacts table** (name/role/mobile[tel]/email/branch). Shown to **anyone who can view the case** (RM/manager/telecaller) — the case already loads the `lenders` collection, so this is pure UI (no rules/data change). Data is maintained by super admins in Masters; here it's view-only.
- **Masters page = super-admin only** (add + view). `navigation.ts` `crm.masters` access `crmAdmin` → **`sa`** (was any admin); `MastersPage.tsx` gate `hasCrm2Perm(crm.masters.write)` → **`isSuperAdmin(user.uid, profile)`** (message updated; `hasCrm2Perm` import dropped, `isSuperAdmin` added). ⚠️ Regular admins (non-super-admin) now lose Masters access — intended. _Server-side the `/api/crm2/masters/*` write API is still admin-gated, not super-admin-gated; the restriction here is the UI surface (the ask). Tighten the API too if hard enforcement is wanted._
- **Masters Lenders list shows more on screen** — added **Login Email** + **Contacts** (count) columns (was only Type + TAT).
tsc + `build:prod` clean. No server/rules/index change.

### Lead form: separate Entity name + Customer name with "same as entity" tick (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00060-gfb` + hosting, verify:deploy 3/3 green)
A lead's borrowing **entity** can differ from the **contact person**. The CRM 2.0 lead form had one `name` field; added a second. New optional field **`Crm2LeadFields.customerName`** (the contact person; `name` is now the **entity** name).
- **Form** (`Crm2LeadsPage` NewLeadModal): the name field relabelled **"Entity Name"**; below it a **"Customer name same as entity name"** checkbox (default ON → mirrors the entity; uncheck reveals a "Customer Name" input). On submit `customerName = sameAsEntity ? name : (typed || name)`.
- **Server** (`server/crm2.ts`): `POST /api/crm2/leads` persists `customerName` (defaults to `name`); `PATCH` allows editing it; **convert** now sets the new client's `primaryContact.name` to `lead.customerName ?? lead.name` (the person), while the client `name` stays the entity.
- **Display**: lead table row + drawer header show a "Contact: {customerName}" line when it differs from the entity name.
- Additive/optional — existing leads (no `customerName`) fall back to `name` everywhere. Promote/meta paths untouched (they fall back). No rules/index change.

### Promote carries the connector through Customer → Lead → Case (2026-06-19) — ✅ DEPLOYED (Cloud Run `pulse-api-00059-9s5`, verify:deploy 3/3 green)
Gap Rahul caught: a Customer sourced by a connector (Source = Connector → `connectorId/connectorCode/connectorName`) lost that connector when promoted to a Lead — the rep then had to re-pick it in the Leads "Sourced by Connector" box. **`POST /api/crm2/leads/:id/promote`** (`server/crm2.ts`) now maps the old customer's **`connectorId/connectorCode/connectorName` → the lead's `channelPartnerId/channelPartnerCode/channelPartnerName`** (the FAC- sourcing-partner attribution), so it's pre-filled on the lead and flows onward automatically (convert already copies `lead.channelPartner*` → `case.channelPartner*`, and the login inherits from the case). Also added **`sub_dsa: "REFERRAL_SUBDSA"`** to `OLD_TO_NEW_SOURCE` (was unmapped → fell back to WALKIN; parity with the legacy `broker` value). Server-only change. No rules/index change.

### Customer page: retire old "Add Opportunity", promote only via "Interested" (2026-06-19) — ✅ DEPLOYED (hosting-only, verify:deploy 3/3 green)
Per Rahul, now that the CRM 2.0 Case pipeline (Customer → Move to Leads → Convert → Client + Case → per-bank logins → disburse → payout) is the working deal flow, the **old Lead→Opportunity model is redundant for NEW deals**. Decisions: **remove "Add Opportunity"**, and **promote to Leads only when status is set to "Interested"** (drop the standalone button). `LeadDetailPage.tsx` only:
- **All 3 "Add Opportunity" entry points removed** — the just-created banner CTA (now reads "Customer saved. Set the status to **Interested** to move them into Leads."), the Opportunities-section header button, and the empty-state "Add the first opportunity →". The **Opportunities section now renders only when the customer already has opportunities** (history); it's hidden entirely for new-model customers. `AddOpportunityPage` + its route `/crm/leads/:leadId/opportunities/new` are **kept but unlinked** (existing opportunities still open via `OpportunityCard` → `OpportunityDetailPage`; the create page is reachable only by direct URL). `Plus` import dropped (now unused).
- **"Move to Leads" standalone button removed** — promotion happens only through the Status dropdown → **Interested** (`handleDisposition` already intercepts `interested` → opens `PromoteToLeadDialog` for `crm.leads.write` holders). `canPromote` + `PromoteToLeadDialog` retained. tsc + `build:prod` clean. No rules/server/index change.

### Fix — Add Customer "Missing or insufficient permissions" (2026-06-19) — ✅ DEPLOYED (deploy:rules, verify:deploy 3/3 green)
A super admin (Kumar) hit **"Missing or insufficient permissions"** saving a customer with **Source = Connector**. **Root cause: NOT a super-admin/role issue** — `isValidLead()` in `firestore.rules` is a schema guard that **every** writer must pass (admins included), and it had drifted out of sync with what `createLead` (`useLeads.ts`) writes:
1. the allowed `source` list still had only the old `'broker'` and was **missing `'sub_dsa'`** — the exact enum value behind the new "Connector" source (renamed broker→sub_dsa earlier) → connector-sourced customers were rejected;
2. the `hasOnly` allowlist was **missing `'assignedToCurrentOwnerAt'` (Phase S) and `'firstContactedAt'` (SLA engine)** — both written on every manual create, so **manual "Add Customer" was actually failing for ALL sources/users** (imports/webhooks use the Admin SDK which bypasses rules, which is why it went unnoticed).
Fix: added `'sub_dsa'` to the `isValidLead` source enum (kept `broker` for legacy) + added the two fields to its `hasOnly`. **deploy:rules only** (ruleset `a31005d2…`). No client/server/index change. _Lesson: when `createLead`/the lead schema gains a field or a source value, update `isValidLead` in the SAME change — the create rule validates admins too, so a super admin is not exempt._

### "Sub DSA" term removed app-wide → everything is "Connector" (2026-06-19) — ✅ DEPLOYED TO PRODUCTION (hosting-only, verify:deploy 3/3 green)
Per Rahul: **the label "Sub DSA"/"Sub-DSA" is gone from the entire UI — every channel-partner surface now reads "Connector".** Labels-only (no data migration); backend identifiers (`subDsas` collection, `subDsaId`, `subDsaPayoutPct`, `SUBDSA_PAID` enum, `sub_dsa` lead-source value, `channelPartnerId`) are unchanged.
- **Masters**: the **"Sub-DSAs" tab was REMOVED entirely** (the SDSA- `subDsas` tier). Its collection/API/auto-mint + the payout engine that references `subDsaId` are untouched in the backend — there is just no Masters UI tab for it now. Tabs are now: **Connectors (FAC-)** · Lenders · Products · Aggregators · DSA Codes · Documents. (`SubDsa` type + `Users2` icon imports dropped from `MastersPage`.)
- **CRM 2.0 leads** (`Crm2LeadsPage`): "Sourced by Sub DSA" → **"Sourced by Connector"** (both the new-lead form + the drawer), the header `Sub DSA <name>` → `Connector <name>`, toast "Sub DSA updated/saved" → "Connector …", and the PARTNER_DSA convert path "Convert to Sub-DSA" → **"Convert to Connector"** (still mints an SDSA- record internally).
- **Case workspace** (`CaseWorkspacePage`): Details row "Sub DSA (Sourced By)" → **"Connector (Sourced By)"**.
- **Disburse dialog** (`LoginsSection`): "Sub DSA payout — {name}" → **"Connector payout — {name}"** (the FAC- channel-partner auto-payout field; the slab leg override field was already "Connector payout % override").
- **MIS overview** (`MisOverviewPage` Disbursals): "Disbursed by Sub DSA" donut + the "Sub DSA" table column → **"Connector"** (grouped by `dsaName`).
- **CRM 2.0 dashboards** (`DashboardsPage`): "Sub-DSA scorecard" → **"Connector scorecard"**.
- **Payout board** (`PayoutBoardPage`): the flow caption "… → sub-DSA → close" → "… → connector → close". (The `SUBDSA_PAID` status + milestone step 9 already displayed as **"Connector Paid"/"Connector paid"** in `PayoutTab.CYCLE_STATUS_LABEL`.)
- Comments referencing "Sub-DSAs (FAC-)" updated to "connectors (FAC-)". tsc + `build:prod` clean. Hosting-only — no rules/server/index change.

### Connectors consolidated to ONE master tab (FAC-) (2026-06-19) — ✅ DEPLOYED TO PRODUCTION (hosting-only, verify:deploy 3/3 green)
Per Rahul: **connectors (the FAC- `/connectors` channel partners that source customers) are now managed in exactly ONE place — CRM → Admin → Masters → "Connectors" tab** — and every other add/sync path was removed. The Masters Connectors tab reads/writes the SAME `/connectors` registry the Add Customer form reads, so anything added there **syncs into the Add Customer "Connector" picker automatically** (same collection — no copy step).
- **New `ConnectorsMasterTab` + `ConnectorFormModal` in `MastersPage.tsx`** (default tab): Active/Inactive/All filter chips (with counts), search, Add/Edit, and an **Activate/Deactivate** action per row (super admin toggles any connector). The **FAC-### code is auto-assigned** (`nextConnectorCode`, shown read-only, never editable). Add form is minimal — name, mobile, email, firm, verticals, status. The Add Customer picker lists only **active** connectors. _Tab order: Connectors · Lenders · Products · Aggregators · DSA Codes · Sub-DSAs · Documents — the old `subDsas` tab (SDSA-, the analytics/payout tier) was **renamed "Connectors" → "Sub-DSAs"** so it no longer collides with the FAC- Connectors tab; its collection/API/auto-mint are untouched._
- **`useConnectors.ts` rewritten**: removed `createConnector`/`updateConnector` (the old PAN+bank `/private/financial` flow), `quickAddConnector`, `getConnectorFinancial`; added lean **`addMasterConnector`/`updateMasterConnector`** (+ `MasterConnectorInput`) — main record only, no PAN/bank sub-doc. `useConnectors`/`nextConnectorCode`/`setConnectorStatus`/`deleteConnector` + the `connector_payouts` helpers kept (the FAC- registry is still READ by the Add Customer + Add Opportunity + CRM 2.0 case/lead pickers).
- **Removed all other add paths**: the inline **"+ New" quick-add** (`QuickAddConnectorModal`) is gone from `NewLeadPage` (Add Customer) and `AddOpportunityPage` (file **deleted**); the entire **HRMS → Connectors page is deleted** (`src/features/hrms/connectors/ConnectorsPage.tsx` removed, its route in `router.tsx`, the `hrms.connectors` nav node in `navigation.ts`, and the `/hrms/admin/connectors` title in `HrmsShell`). The connector pickers on both forms now just point users to "CRM → Admin → Masters → Connectors" to add.
- **⚠️ Consequence (flagged):** deleting the HRMS Connectors page also removed the only UI for (a) connector **PAN/bank** (`/connectors/{id}/private/financial`) entry, (b) the **`connector_payouts` mark-paid** flow, and (c) the **FAC- per-product auto-payout-rules editor** (`Connector.payoutRules`). The server still auto-creates `connector_payouts` on CRM 2.0 disburse, but there is now **no UI to mark them paid or to configure payoutRules** — relocate into the Masters Connectors tab if/when needed. Also: `/connectors` rules allow **create** by admin/HR/`hasCrmAccess` but **update** only by admin/HR — a Masters-write user who isn't admin/HR could add but not edit/toggle; super admins (admins) are unaffected. No rules change this round.
- tsc + `build:prod` clean. Hosting-only — no rules/server/index change.

### Old-CRM "Connector" terminology + conditional source picker (2026-06-19) — ✅ DEPLOYED TO PRODUCTION (2026-06-19, hosting-only, verify:deploy 3/3 green)
Per Rahul, the FAC- channel-partner entity is labelled **"Connector"** across the **old-CRM lead→opportunity flow** (enum value still `sub_dsa` — display-only, no migration/type churn):
- **`NewLeadPage.tsx`** (Customers → New Customer): Source dropdown option **"Sub DSA" → "Connector"**; the FAC- `/connectors` picker is now **conditional — shown only when Source = Connector** (was always visible), relabelled **"Sourced by Connector"** ("Select connector…" / "Direct / no Connector"); switching source away from Connector clears the selection (`useEffect` + submit guard `values.source === 'sub_dsa'`).
- **`AddOpportunityPage.tsx`**: "Sourced by Sub DSA" → "Sourced by Connector" (label/options/placeholder/hint), and the DSA-code routing cards ("we owe the Connector a payout", "Connector's own code", "Bank pays the Connector directly").
- **`OpportunityDetailPage.tsx`**: "Sourced by Sub DSA" → "Sourced by Connector".
- **Display labels**: `sub_dsa` → **"Connector"** in `LeadsPage`/`LeadDetailPage` (source label + `· Connector:` header)/`MyQueueRow`/`CrmDashboardPage`.
- **`QuickAddConnectorModal`**: gained optional **`entityLabel`** prop (default `"Sub DSA"`); NewLeadPage + AddOpportunityPage pass `"Connector"` so the "+ New" dialog title/placeholder/button read "Connector".

> **⚠️ Deliberately NOT changed — CRM 2.0 naming collision.** In CRM 2.0 (per the Phase-1 three-tier rename) **"Connector" already means `subDsas`/SDSA-** — a *different* entity from the FAC- channel partner (which CRM 2.0 calls **"Sub DSA"**). Renaming FAC-→"Connector" inside CRM 2.0 (`Crm2LeadsPage`, `CaseWorkspacePage`, `LoginsSection`) and the **HRMS connectors page nav (still "Sub DSA")** would collide with that existing "Connector"=SDSA label. So the rename is scoped to **old-CRM only**; the same FAC- registry now reads "Connector" in old-CRM but "Sub DSA" in CRM 2.0/HRMS. Resolving the full app-wide terminology (incl. reverting the Phase-1 "Sub DSA" rename) is a larger decision left open.

tsc + `build:prod` clean. **Hosting-only — run `npm run deploy` to make it live** (a hard refresh shows the OLD bundle until then). No rules/server/index change.

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

### Data maintenance — CRM wipe script (2026-06-25)
**`scripts/maintenance/wipeCrmData.ts`** (npm: **`wipe:crm:dry`** = dry run, **`wipe:crm`** = `--confirm` live delete) — a one-off, **dry-run-by-default, destructive** clean-slate tool that empties **only** `leads` (old Customers + CRM 2.0 Leads), `cases`, `clients`, `payoutCycles`, `misRecords`, `import_jobs` — each via Admin SDK **`recursiveDelete`** so ALL nested subcollections go too (opportunities/activities/bank_submissions, applicants/docTracker/logins/stageHistory/private/tasks, whatsapp, field_history, vaultDocs). **Never touches** masters (aggregators/lenders/products/subProducts/dsaCodeMappings/documentMaster), connectors, users, counters, or HRMS/MIS config (hard-coded TARGETS list). **Counters are left intact** so fresh uploads keep incrementing ids (no reuse/collision). Deletes are server-only in rules (`allow delete: if false`), so this Admin-SDK script (or the console) is the only way. **Runbook**: (1) `gcloud firestore export gs://gen-lang-client-0643641184-fs-backup/wipe-<date> --database=pulse` (7-day PITR is the second net); (2) `set GOOGLE_APPLICATION_CREDENTIALS=…` then `npm run wipe:crm:dry` → review per-collection counts; (3) `npm run wipe:crm` (5-second Ctrl-C abort window). Verified on the emulator: recurses 2-level-deep subcollections, leaves masters/users untouched.
**✅ EXECUTED against prod 2026-06-25** (SA key in the maintainer's Downloads): backed up to `gs://gen-lang-client-0643641184-fs-backup/wipe-2026-06-25` (export SUCCESSFUL) → wiped **2662 leads · 5 cases · 7 clients · 5 import_jobs** (payoutCycles/misRecords already 0); re-count is 0/0/0/0/0/0. Masters/connectors/users (25)/counters intact. Out-of-scope logs left as-is: `lead_view_logs` (1095), `meta_lead_events`/deadletters, `whatsapp_message_events`/deadletters, `crm2_reminder_logs` (19). CRM is a clean slate for fresh uploads.

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
