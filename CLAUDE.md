# Finvastra Pulse

> **Product name: Finvastra Pulse.** Internal application replacing Zoho-class SaaS. **Three modules**: HRMS (workforce), CRM (customer pipeline), and MIS (back-office commission reconciliation) for the ~25-person Finvastra team. Lives at `pulse.finvastra.com` (subdomain on Hostinger DNS, app served from Firebase). Built on Firebase + React + Vite + Express. **Owned by Finvastra.**

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
| Email | Resend (free tier) | System notifications |

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
| 4.1 MIS shell + manual statement upload | ⬜ Pending | `MisShell` at `/mis/*`; `misAccess` guard; manual entry of received commission statements |
| 4.2 Reconciliation UI | ⬜ Pending | Match `/commission_statements` lines to `/commission_records`; flag discrepancies |
| 4.3 RM payout slabs + monthly generation | ⬜ Pending | `/rm_payouts` per RM per month; % of received (not expected) with its own slab config |
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
| 2.8 Transaction cleanup | ⬜ Pending — before prod | `setPrimarySubmission` + all multi-step writes wrapped in `runTransaction`; seed buttons removed from prod |
| 2.5b Social/website webhook intake | ⬜ Pending | Real-time webhook for Meta Ads + website form leads; working-day SLA |
| 2.5c Lead queue + transfer UI | **✅ Complete** | My Queue page; urgency-sorted queue; inline log-call; transfer-to-specialist modal; QuickContactBar on LeadDetailPage; overdue badge in nav |
| 2.5d Drive doc vault | ⬜ Pending | Google Drive integration per opportunity |
| 2.7 Wealth investments | ⬜ Pending | Investment tracking subcollection on wealth opportunities |
| 2.8b Insurance policies | ⬜ Pending | Policy management subcollection on insurance opportunities |

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

| Role | Function |
|---|---|
| `lead_generator` | Sources leads (offline bulk, walk-ins, referrals). `primaryOwnerId` on the lead. Works opportunities at early stages. |
| `lead_convertor` | Closes deals. `ownerId` on the opportunity (set when transferred). Vertical-specific: `convertorVertical` must match `opportunity.opportunityType`. |
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

### Round-robin assignment
On bulk import, leads are assigned by `batchRowIndex % generatorCount` where generators are sorted by `userId` for deterministic ordering. Phase 2.5b will add workload-aware FIFO.

### ImportBatchId provenance
Every bulk-imported lead carries `importBatchId: 'YYYY-MM-DD-XXXX'` linking it to an `/import_jobs/{id}` doc that records row counts, errors, and who triggered the import.

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

- **`setPrimarySubmission` race condition** (`src/features/crm/hooks/useBankSubmissions.ts`): uses `getDocs` then a sequence of `updateDoc`/`addDoc` calls — not transactional. Two concurrent clicks could create **duplicate commission_records** (financial data integrity risk) and dual-primary submissions. Promoted to **Phase 2.8** — must be fixed before production load. Wrap the entire sequence in `runTransaction(db, ...)`.
- **Seed buttons exposed in prod**: `CrmDashboardPage.tsx` admin setup panel (Seed Config, Migrate Leads, Seed Sample Slabs) is now gated behind `import.meta.env.DEV` — hidden in production builds. Verify this holds after any bundler config changes.
- **Role check reads Firestore** (`isAdmin()` and `hasCrmAccess()` in `firestore.rules`): each request does a `get()` on `/users/{uid}`. Migrate to custom claims via a Cloud Function trigger for performance and to eliminate this per-request read (TODO comment already in rules).
- **Attendance timestamps are strings** (`checkIn`, `checkOut`): stored as ISO strings, not `serverTimestamp()`. Firestore rules can only validate format, not prevent backdating. Rebuild attendance with `serverTimestamp()` in Phase 3.
- **Cross-tenant profile read** (Dirty Dozen Payload 12): all signed-in users can `get` any user profile doc (required for the employee directory). Field-level security requires either a server proxy or splitting public/private profile docs. Review in Phase 6.

## Pre-launch checklist

Items that **must be resolved before any production traffic hits the app**. Each has a severity and the phase it belongs to.

| # | Item | Severity | Phase | File / Location |
|---|------|----------|-------|-----------------|
| 1 | **`setPrimarySubmission` not transactional** — duplicate commission_records possible under concurrent writes | 🔴 Financial integrity | 2.8 | `src/features/crm/hooks/useBankSubmissions.ts` |
| 2 | **Seed/migration buttons on CRM dashboard** — currently gated by `import.meta.env.DEV`; confirm this survives any prod bundler config change | 🔴 Data pollution | 2.8 | `src/features/crm/dashboard/CrmDashboardPage.tsx` |
| 3 | **Role checks read Firestore on every request** — `isAdmin()` and `hasCrmAccess()` each do a `get()` call; migrate to custom claims via Cloud Function | 🟡 Performance | 6 | `firestore.rules` |
| 4 | **Attendance timestamps are strings** — `checkIn`/`checkOut` stored as ISO strings, not `serverTimestamp()`; Firestore rules can only validate format, not prevent backdating | 🟡 Security | Phase 3 rebuild | `src/lib/hooks/useAttendance.ts` |
| 5 | **Cross-tenant profile read** (Dirty Dozen Payload 12) — all signed-in users can `get` any user profile; required by directory but exposes private fields | 🟡 Privacy | 6 | `firestore.rules` |
| 6 | **Import batch processing in Express** — background `processImportBatch()` runs in the same process as the HTTP server; large imports risk Cloud Run timeout | 🟠 Reliability | 6 | `server.ts` → migrate to Cloud Function |
| 7 | **Service account email for Sheets API** — production ADC email must be confirmed and the template Sheet shared with it before enabling bulk import | 🟠 Config | Pre-launch | `server.ts` `TEMPLATE_SHEET_URL` + Cloud Run SA email |
| 8 | **CLAUDE.md `TEMPLATE_SHEET_URL` placeholder** — replace with the real published template Sheet URL | 🟢 Docs | Pre-launch | `server.ts` line 1 |
| 9 | **Generate and set `PAN_ENCRYPTION_KEY`** — generate a 64-char hex key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and add to `.env.local` (dev) and Cloud Run env (prod). Then run the "Migrate PAN Encryption" button from the admin dashboard once. | 🔴 Security | Pre-launch | `server.ts` `/api/admin/migrate-pan-encryption` |
| 10 | **Configure `RESEND_API_KEY`** — add to Cloud Run env vars for new-device login alert emails to work | 🟠 Config | Pre-launch | `server.ts` `/api/auth/login-alert` |
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
| Rate limiting | ✅ Added | In-memory sliding window; upload 10/hr, calendar-sync 20/hr, import 5/hr per user |
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

## Known context for the build

- Solo developer (Rahul) on this. Part-time alongside other Finvastra work.
- Director (Ajay) is non-technical. UI must be self-explanatory.
- 25-employee scale today, designed to handle 250 without architecture changes.
- Marketing site `finvastra.com` runs on Hostinger. This app lives at `pulse.finvastra.com` via DNS CNAME → Firebase Hosting. No conflict between the two.
- Today's date when this file was written: **May 19, 2026.** Production launch target: **end of October 2026.**
