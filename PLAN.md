# PLAN.md — CRM / Leads / Payout Cycle / MIS Build (Phase 0)

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

## E. ⚠️ BLOCKING DECISIONS — need sign-off before Phase 1

**1. `connectors` collection name collision.**
The spec's `connectors` (upstream aggregators: Ruloans, Shraddha…) collides with the
existing live `/connectors` (Phase Q channel partners FAC-###, who are conceptually the
spec's *downstream* subDsas). Spec simultaneously says "do not break existing collections"
and defines `connectors/{CONN-001}`. Options:
- **(a) RECOMMENDED:** new collection **`aggregators/{CONN-xxx}`**, UI-labelled
  "Connectors (Aggregators)". Spec interface unchanged; only the collection name differs.
  Existing Phase Q `/connectors` continues serving the old CRM until §13, then its records
  are offered a one-off migration into `subDsas`.
- (b) Reuse `/connectors` for both shapes (discriminator field) — rejected: mixes upstream
  and downstream, the exact thing §1 forbids.
- (c) Migrate Phase Q connectors out first to free the name — rejected for v1: touches live
  lead/opportunity/commission_records references mid-build.

**2. Permission model.** Pulse has role flags + custom claims, not granular keys. Proposal:
- `users/{uid}.perms: { 'crm.leads.read': true, … }` map, edited in a new Permission Manager
  section, synced into custom claims by the existing sync-claims endpoint (9 keys ≈ 300
  bytes — well under the 1,000-byte claims limit). Super admins implicitly hold all keys.
- **2b. Money split:** `payout.amounts.read` gates *documents*, not fields: `payoutCycles` and
  `misRecords` (all-money docs) are readable only with the key; the **case money mirror**
  moves to `cases/{id}/private/payout` (sub-doc, key-gated) while `payoutStatus` badge stays
  on the case doc for everyone with `crm.cases.read`. This follows the existing
  `/connectors/{id}/private/financial` split. *Deviation from spec's inline-mirror shape —
  required for rule-enforceable field gating.*

**3. Nav placement during coexistence.** New screens mount in CrmShell under a separate
group **"Pipeline"** (Masters / Leads / Cases / Payouts / MIS / Recon), old screens stay where
they are until §13 renames them "Archive". Alternative: a fourth module shell — rejected
(spec says CRM module).

**Minor (will proceed as stated unless overridden):** `EncryptedField` object instead of
string for `*Enc`; vitest added; thresholds in `app_config/crm2_settings`; new server code in
`server/crm2.ts`; FAPL-xxx stored in new collections with uid→FAPL resolution middleware.
