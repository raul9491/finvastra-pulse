# PLAN.md — CRM / Leads / Payout Cycle / MIS Build

> **Progress**: Phase 0 ✅ · Phase 1 ✅ (`a481532` + gate fixes `a68e85d`, 12/12 wiring test)
> · **Phase 2 ✅ (2026-06-13)** — leads extension live on the existing collection, public
> intake `POST /api/public/leads` (rate-limited, honeypot, UTM), dedupe (`dupeKeys` +
> `duplicateOfLeadId`, flag-never-block), `POST /api/crm2/leads` + `PATCH /api/crm2/leads/:id`
> (activity log), `POST /api/crm2/leads/:id/convert` (ONE transaction → client CL- + case
> FIN-CASE- OPENED + PRIMARY applicant + docTracker expansion; PARTNER_DSA → subDsa),
> migration script `scripts/migrate/normaliseCrm2Leads.ts` (DRY_RUN verified on emulator),
> perms editor `/crm/pipeline/permissions` (POST `/api/crm2/perms/:uid`, instant claim
> refresh), leads UI `/crm/pipeline/leads` (funnel chips, SLA highlight, dup banner,
> activity drawer, convert dialog). Acceptance 15/15 (`.qa/crm2-phase2-gate.mjs`) + 21 unit
> tests. Internal lead routes use the `/api/crm2/` prefix (collision-free namespacing;
> public path matches spec exactly). NOT deployed.
> **Next: Phase 3** (cases CRUD, stage machine + doc gating, applicants, vault, case workspace UI).

Maps the approved spec onto the actual `finvastra-pulse` repo. Implementation follows the
spec's phases 1–5, one commit per phase. **Three blocking decisions at the bottom need
sign-off before Phase 1 starts.**

---

## A. Repo reality → spec mapping

| Spec assumption | Repo reality | Plan |
|---|---|---|
| Firestore DB `pulse` | Client: `src/lib/firebase.ts` reads `firestoreDatabaseId` from `firebase-applet-config.json`. Server: `FIRESTORE_DB_ID = "pulse"` in `server.ts`. | Reuse both as-is. |
| Express API on Cloud Run | Single-file `server.ts` (~3,500 lines), deployed `gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling` (keep the flag). | New endpoints go in a **new module `server/crm2.ts`** exporting `registerCrm2Routes(app, deps)` — keeps server.ts from doubling in size while following its conventions (same auth helpers, error shape). |
| Auth middleware | `verifyFirebaseToken(req)` → uid; role checks read `users/{uid}` or custom claims. | Reuse. New `requirePerm(key)` wrapper (see Decision 2). |
| Email | `sendGmailMessage` / `sendGmailWithAttachment` + `buildBrandEmail` (Gmail DWD) in server.ts. | Reuse for reminders + business-sheet mailing. |
| Encryption utility | `src/lib/encryption.ts` — `encryptField/decryptField` (AES-256-GCM, **server-only**, key `PAN_ENCRYPTION_KEY`). Returns an **`EncryptedField` object** `{ciphertext, iv, tag, keyVersion}`, not a string. | All `*Enc` fields store the `EncryptedField` object (spec's `panEnc: string` adjusted accordingly). Encrypt/decrypt only inside Express. |
| Commission-import parsing | `/api/mis/statements/upload` CSV parse + column auto-detect in server.ts; `xlsx` already a dependency (works server-side for the business-sheet export and recon dump parsing). | Reuse parser + column-detect for `POST /api/recon/imports`. |
| Scheduler pattern | Cloud Scheduler → `POST /api/admin/run-*` guarded by `requireAdminOrScheduler` (OIDC SA `787616231546-compute@…`). | New jobs: `run-payout-reminders` (daily), `run-vault-expiry` (daily), `run-recon-snapshots` (monthly). Job thresholds in a new `app_config/crm2_settings` doc (existing `app_config` pattern, not `counters/../config`). |
| Notifications/tasks | `notifications/{uid}/items` + `writeNotification`; no separate task system. | Reminder jobs write bell notifications + email (existing dual-channel pattern). |
| UI system | Feature folders `src/features/*`, glass design system, `lazyPage` code-split routes, `SearchableSelect`/`Modal`/`Badge`, field-level form validation standard, NOTHING-LOCKED nav rule. | New code under **`src/features/crm2/`** (masters/, leads2/, cases/, payouts/, mis2/, recon/) mounted in CrmShell under a new nav group (see Decision 3). |
| Employee IDs `FAPL-xxx` | Users are keyed by **Firebase UID**; `employeeId: 'FAPL-xxx'` is a field on `users/{uid}`. All existing ownership fields store UIDs. | Per spec, all NEW collections store **FAPL-xxx** in `createdBy/updatedBy/handlingRm/ownerRm/relationshipOwner/...`. Server audit middleware resolves uid→employeeId once per request (cached map). UI resolves FAPL→displayName via the already-loaded employees list. |
| Google Sign-in "removed" | **Repo still has Google OAuth login** alongside email/password. | No auth changes in this build; flagging the spec/context mismatch. |
| Firestore emulator + tests | Emulators configured (`npm run dev:emulators`, seed script, `.qa/phase-p-usecases.sh` integration pattern). **No unit-test framework.** | Add **vitest** (devDep) + `npm run test`. Pure functions in `src/lib/crm2/` (`resolveSlab`, `deriveCycleStatus`, `computeAgeing`, `computeVariance`, `gateStage`, `normaliseDupeKeys`) each with a sibling `*.test.ts`. Integration tests for convert/disburse/milestone as a `.qa/crm2-usecases.sh`-style emulator script. |
| Counters | No transactional counter pattern exists (`nextConnectorCode` is client-side max+1). | New server util `nextId(tx, counterId, prefix, pad)` — read counter → increment → return id, inside the caller's transaction. Year-scoped (`leads-2026`), lazily created. |
| Public lead intake | `/api/leads/intake/website` exists (secret-header auth). | New `POST /api/public/leads` per spec (no auth, rate-limited via existing Firestore rate-limit util, honeypot, strict validation). Old webhook stays untouched. |

## B. Collection-level mapping

| Spec collection | Status | Notes |
|---|---|---|
| `lenders`, `products`, `subDsas`, `documentMaster`, `dsaCodeMappings` | NEW | Straightforward. `products` is distinct from existing `/opportunity_types` (old CRM keeps its own). |
| `connectors` | **COLLISION** — see Decision 1 | Existing `/connectors` = Phase Q channel partners (FAC-###) which are conceptually the spec's **subDsas** (downstream), not its upstream aggregators. |
| `leads` | EXTEND (additive) | Existing docs keep all old fields; migration script adds `category/sourceMeta/dupeKeys/priority/...`, maps old `leadStatus` → spec `status` (new→NEW, interested→CONTACTED, callback→ATTEMPTED, not_interested→NOT_INTERESTED, no_response/wrong_number→DROPPED), maps `displayName`→`name` mirror. Old CRM screens keep reading old fields — zero breakage. |
| `clients`, `cases` (+subcollections), `payoutCycles`, `misRecords`, `bankMisImports`, `reconSnapshots`, `counters` | NEW | `misRecords` doc-id == case-id. Note: existing `/import_jobs` is unrelated to `bankMisImports`. |
| Old `bank_submissions`/`commission_records`/`commission_statements`/`rm_payouts` | FREEZE at §13 (after Phase 5) | Menu renamed "Archive"; collections untouched. |

## C. Phase plan → concrete files

**Phase 1 — foundations + masters**
- `src/types/crm2.ts` (all spec interfaces, `Audit`, `Address`), `src/lib/crm2/ids.ts` (counters), `src/lib/crm2/slab.ts` (+tests), `server/crm2.ts` (audit middleware, masters CRUD, perm guard), `scripts/seed/seedDocumentMaster.ts`, `scripts/seed/seedLendersProducts.ts` (reads `scripts/seed/crm2-masters.json` the team fills), rules blocks + composite indexes (incl. the new field-override lesson: any bare collection-group equality gets a fieldOverride), Permission Manager extension (Decision 2), masters UI (`src/features/crm2/masters/` — Lenders, Products, Connectors, Mapping editor w/ slab timeline + overlap validation + end-and-add flow, SubDsas, DocumentMaster).
- Acceptance: mapping with 2 slab generations; overlap rejected; `resolveSlab` tests green (boundaries, zero-match, multi-match typed errors).

**Phase 2 — leads**
- Lead extension types, `POST /api/public/leads`, dedupe (`dupeKeys` array-contains across leads+clients), `POST /api/leads/:id/convert` transaction (client+case+PRIMARY applicant+docTracker expansion / PARTNER_DSA→subDsa), `scripts/migrate/normaliseLeads.ts --dry-run`, leads UI (funnel filters, SLA highlight, dup banner, activity drawer, convert dialog).

**Phase 3 — cases**
- Case CRUD + stage machine (`src/lib/crm2/stages.ts` gating pure fn + tests), applicants CRUD (Aadhaar 12-digit rejection at API), docTracker idempotent expansion + `docsCompletePct` recompute, client vault (Storage path `clients/{id}/vault/…` + storage.rules block), stageHistory, Case workspace UI (header/stepper/tabs).

**Phase 4 — payout engine**
- `POST /api/cases/:id/disburse` (slab freeze, ONE batch: case+payoutCycle+misRecord+stageHistory), `PATCH /api/payout-cycles/:id/milestone` (step-order validation + override log, ONE batch: cycle+case mirror+misRecord), pure fns `deriveCycleStatus`/ageing/variance (+tests), business-sheet xlsx export + share-stamping, reminder + vault-expiry jobs, Payout board UI + case Payout tab (10-step timeline, amounts gated).

**Phase 5 — recon + dashboards**
- `POST /api/recon/imports` (xlsx/csv → rows; match: loanAccountNo → bankApplicationNo → fuzzy dsaCode+amount±1%+date±7d), manual match/unmatch, dispute flow, monthly `reconSnapshots` job, recon UI, Command Centre dashboard additions.

## D. Security model

- Rules: all new collections **deny client writes** (Express/Admin-SDK only) except low-risk lead free-text (activityLog/follow-up), matching the existing leads pattern. Reads gated by the perm keys (claims-first, get() fallback — same as existing role helpers).
- Money visibility (`payout.amounts.read`): Firestore cannot field-gate reads, so money fields live in **doc splits**, mirroring the existing `/connectors/{id}/private/financial` pattern (Decision 2b).

---

## E. ✅ SIGNED-OFF DECISIONS (Rahul, 2026-06-13) — these OVERRIDE the original spec wording

> Any later phase or fresh agent session implementing this spec MUST follow these three
> resolutions. Do not drift back to the original spec's collection map / inline-mirror /
> nav wording.

**1. Upstream aggregators live in `aggregators/{CONN-xxx}` — NOT `connectors/`.**
The spec's `connectors` (upstream: Ruloans, Shraddha, Star Digiloans) collides with the
EXISTING live `/connectors` collection (Phase Q channel partners FAC-###, conceptually the
spec's *downstream* subDsas). Resolution: the spec's Connector interface is implemented
unchanged but stored in a new **`aggregators`** collection (ids `CONN-001`…), UI-labelled
"Connectors". Everywhere the spec says `connectorId` (cases, payoutCycles, misRecords,
dsaCodeMappings, reconSnapshots ids) the field name stays `connectorId` but it references
`aggregators/{id}`. The existing Phase Q `/connectors` keeps serving the old CRM untouched
until §13, when its records are offered a one-off migration into `subDsas`.

**2. Permission keys = `users/{uid}.perms` map + custom claims; money gating = doc split.**
- `perms: { 'crm.leads.read': true, … }` on the user doc, edited in a new Permission Manager
  section, included in the existing sync-claims payload. Super admins and `role === 'admin'`
  implicitly hold all keys.
- **Money split (deviation from spec's inline shapes, required for rule-enforceable
  gating):** `payoutCycles` and `misRecords` docs are readable ONLY with
  `payout.amounts.read`. The Case's money mirror (pcts/expected/margin) lives in
  **`cases/{id}/private/payout`** (key-gated subdoc, same pattern as the existing
  `/connectors/{id}/private/financial`); the `payoutStatus` badge + `payoutCycleId` stay on
  the main case doc for everyone with `crm.cases.read`.

**3. Nav: new screens mount in CrmShell under a "Pipeline" group**
(Masters / Leads / Cases / Payouts / MIS / Recon). Old CRM screens stay put until §13
renames them "Archive". No fourth module shell.

**Claims staleness (gate fix, 2026-06-13):** sync-claims (single + bulk) stamps
`claimsRefreshedAt` on the user doc after `setCustomUserClaims`; AuthContext's live profile
listener force-refreshes the ID token (`getIdToken(true)`) when that timestamp advances.
Grants were already instant (rules/API fall back to the live user doc); this makes
**revocations** instant too instead of waiting out the ≤1h token rotation. The perms editor
relies on this — no re-login needed.

**Minor conventions (also locked):** `*Enc` fields store the existing `EncryptedField`
OBJECT (`{ciphertext, iv, tag, keyVersion}`), not a string; vitest for unit tests; job
thresholds in `app_config/crm2_settings`; new server code in `server/crm2.ts` registered
from server.ts; new collections store **FAPL-xxx** (not uids) in people fields, resolved by
server middleware.
