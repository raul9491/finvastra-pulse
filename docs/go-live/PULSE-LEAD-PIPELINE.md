# Pulse Lead Pipeline — consolidated GO-LIVE runbook

Deploys and verifies the **three layers together**, end to end:

1. **Meta Lead Ads webhook** (Phase 1) — real-time intake → CRM 2.0 lead (`source ADS`).
2. **Two-stage SLA engine** (Phase 2) — time-to-assign + time-to-first-contact, working-time, notify-only.
3. **FIFO pull queue** — warm inbound leads sit oldest-first; telecallers claim the front of the line.

All three are on `main`, gate-green, **not deployed**. This runbook **supersedes
`docs/meta-webhook/GO-LIVE.md`**. Steps are tagged **`[deploy]`** (run the command),
**`[HUMAN]`** (console/Meta action), **`[verify]`** (check before proceeding).

> **Launch gate:** do not turn on ad budget until a **real test lead** flows
> capture → queue → claim → first-contact, and a **controlled breach** alert reaches a
> manager — all verified below.

Constants used throughout:
- Cloud Run service `pulse-api`, region `asia-south1`, run URL
  `https://pulse-api-787616231546.asia-south1.run.app`.
- Scheduler OIDC SA `787616231546-compute@developer.gserviceaccount.com`.
- App `https://pulse.finvastra.com`. Firestore DB `pulse`.

---

## 1. Pre-deploy config checklist `[HUMAN]`

### 1a. Cloud Run env vars (secrets — never commit/log)
| Var | Value |
|---|---|
| `META_VERIFY_TOKEN` | arbitrary string; also typed into Meta's webhook UI (handshake) |
| `META_APP_SECRET` | Meta App → Settings → Basic → **App Secret** (HMAC key — the security boundary) |
| `META_PAGE_ACCESS_TOKEN` | **long-lived System User token** with `leads_retrieval` + `pages_manage_metadata` (NOT a ~60-day Page token) |
| `META_GRAPH_VERSION` | current latest GA (e.g. `v23.0`) |

> **Never set `META_GRAPH_BASE` in prod** — it must default to `https://graph.facebook.com`
> (it exists only so the emulator gate can mock Graph).
> **`GOOGLE_SA_JSON_BASE64` must already be present** (it powers Gmail domain-wide
> delegation). If absent, SLA/queue escalation **emails silently no-op** — in-app `notify`
> bells still fire. Confirm it's set.

### 1b. Firestore `app_config` docs `[HUMAN]`
Create/confirm via **Firebase Console → Firestore → `app_config`** (an admin can write
these; rules allow admin/HR-manager). All SLA windows are **working-milliseconds**.

**`app_config/sla`** (defaults apply per field if the doc/field is absent — but
`escalationUids` has no default, see below):
```jsonc
{
  "WARM":   { "stage1Ms": 900000,   "stage2Ms": 1800000 },   // 15 wm assign · 30 wm contact
  "COLD":   { "stage1Ms": 172800000,"stage2Ms": 86400000 },  // 48 wh assign · 24 wh contact
  "MANUAL": { "stage1Ms": 0,        "stage2Ms": 1800000 },   // assigned at t=0 · 30 wm contact
  "escalationUids": ["<manager-uid>", "<backup-uid>"]
}
```
> **`escalationUids` is REQUIRED.** Stage-1 (unassigned/in-queue) and queue-backlog alerts
> route here (Stage-2 goes to the lead's owner + their `reportingManagerUid`). **Empty ⇒
> Stage-1 alerts fall back to active admins**; set explicit triage manager uid(s) + one
> backup so they land on the right person.

**`app_config/business_hours`** (defaults to exactly this if the doc is absent):
```jsonc
{
  "tzOffsetMinutes": 330,                 // IST (+5:30, no DST)
  "startMinutes": 600,                    // 10:00
  "endMinutes": 1110,                     // 18:30
  "workingDows": [1,2,3,4,5,6],           // Mon–Sat (Sun off)
  "offSaturdayOrdinals": [1,2]            // 1st & 2nd Saturdays off
}
```

**`app_config/queues`** (defaults to Loans + SIP if absent):
```jsonc
{
  "queues": [
    { "id": "loans", "name": "Loans", "skill": "LOANS", "productFilter": ["LOAN"] },
    { "id": "sip",   "name": "SIP",   "skill": "SIP",   "productFilter": ["WEALTH"] }
  ]
}
```
> For **one shared FIFO**, use a single queue with `"productFilter": ["*"]`.

### 1c. Per-telecaller `queueSkills` `[HUMAN]`
On `/users/{uid}` set `queueSkills: ["LOANS"]` / `["SIP"]` to gate who can pull from
which queue. **Empty/unset = eligible for ALL queues** (works out of the box). Admin-write
only (not self-editable).

---

## 2. Deploy sequence `[deploy]`

```bash
# 0. From a clean main (gates green): tsc + unit + the three gates (offline)
npm run lint && npm test && npm run qa:meta && npm run qa:sla && npm run qa:queue

# 1. Rules (Meta event-store + dead-letters; SLA firstContactedAt allowlist; queue comment)
npm run deploy:rules
npm run verify:deploy            # confirms rules are bound to `pulse` (1 of 3 checks)

# 2. Indexes — wait until ALL show READY in the console before step 3.
#    New composites: leads(firstContactedAt,converted), leads(firstContactedAt,deleted),
#    leads(assignedRm,converted,receivedAt). (meta_lead_events.status is single-field/auto.)
npm run deploy:indexes

# 3. Server — sets the four META_* env vars in the same deploy.
gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling \
  --update-env-vars "META_VERIFY_TOKEN=…,META_APP_SECRET=…,META_PAGE_ACCESS_TOKEN=…,META_GRAPH_VERSION=v23.0"

# 4. Hosting + full post-deploy verify (app shell + deep health + rules bind = 3/3)
npm run deploy
npm run verify:deploy
```
> `--no-cpu-throttling` is **required** — the webhook ACKs fast then does the Graph pull
> post-response, and the SLA/queue work runs in-process; a throttled container starves it.

### 2.5 Cloud Scheduler jobs `[deploy]`
```bash
# Meta retry — drains pending/failed leadgen events.
gcloud scheduler jobs create http crm2-meta-retry --location=asia-south1 \
  --schedule="*/10 * * * *" \
  --uri="https://pulse-api-787616231546.asia-south1.run.app/api/crm2/jobs/run-meta-retry" \
  --oidc-service-account-email="787616231546-compute@developer.gserviceaccount.com" \
  --http-method=POST --headers="Content-Type=application/json" --message-body='{}'

# Two-stage SLA sweep — measures + alerts on time-to-assign / time-to-first-contact.
gcloud scheduler jobs create http crm2-lead-sla-sweep --location=asia-south1 \
  --schedule="*/15 * * * *" \
  --uri="https://pulse-api-787616231546.asia-south1.run.app/api/crm2/jobs/run-lead-sla-sweep" \
  --oidc-service-account-email="787616231546-compute@developer.gserviceaccount.com" \
  --http-method=POST --headers="Content-Type=application/json" --message-body='{}'

# Smoke each once (expect Cloud Run 200):
gcloud scheduler jobs run crm2-meta-retry      --location=asia-south1
gcloud scheduler jobs run crm2-lead-sla-sweep  --location=asia-south1
```
> The queue (`/api/crm2/queue/*`) is request-driven — **no scheduler job**.
> Optional but recommended: the Meta **dead-letter alert policy** (log-based metric +
> alert on `jsonPayload.event="meta_lead_deadletter"`) — commands in
> `docs/meta-webhook/GO-LIVE.md` §5.

### 2.6 Meta-side wiring `[HUMAN]`
1. App Dashboard → **Webhooks → Page** → callback URL
   `https://pulse.finvastra.com/api/webhooks/meta/leadgen`, Verify Token = `META_VERIFY_TOKEN`.
2. Subscribe to the **`leadgen`** field.
3. Subscribe the **Page** to the app: `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`;
   confirm with `GET /{page-id}/subscribed_apps`.
4. Ensure the System User token holds `leads_retrieval` + `pages_manage_metadata` on that Page.
5. **The Instant Form MUST include a product question** (e.g. "Which product?" → Home Loan /
   LAP / Personal Loan / SIP / Insurance) — Phase 2 routing + queue bucketing depend on it;
   step 3b flags its absence.

### 2.7 Endpoint smoke `[verify]`
```bash
# Handshake (replace the token):
curl "https://pulse.finvastra.com/api/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=PING"   # → PING
# Unsigned POST is rejected:
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://pulse.finvastra.com/api/webhooks/meta/leadgen \
  -H "Content-Type: application/json" --data '{"object":"page","entry":[]}'   # → 403
```

---

## 3. Full-lifecycle smoke test (post-deploy)

Get an **admin Firebase ID token** (browser devtools of a signed-in admin) and export it:
```bash
export PULSE_ADMIN_TOKEN="<admin-id-token>"
export META_ADMIN_TOKEN="$PULSE_ADMIN_TOKEN"   # qa:meta:inspect uses this name
```
> Run the SLA parts (3f especially) **during IST working hours (Mon–Fri / 3rd–5th Sat,
> 10:00–18:30)** so the working-time clock actually advances.

**a. `[HUMAN]` Fire a test lead** — Meta **Lead Ads Testing Tool**
(developers.facebook.com/tools/lead-ads-testing) → pick the Page + Form → **Create Lead**.
Note the `leadgen_id`.

**b. `[verify]` It landed + mapped correctly:**
```bash
npm run qa:meta:inspect -- <leadgen_id>
```
Expect: event `status: done`; a CRM 2.0 lead (`source ADS`, `status NEW`); name/phone mapped;
`✓ product interest captured` (or the `GENERAL` blocker warning → fix the form, step 2.6.5).
Grab the printed lead id (`LD-YYYY-#####`), then:
```bash
npm run sla:inspect -- <leadId>
```
Expect: `capture` set · `assigned —(in queue)` · `firstContact —` · no breaches · status NEW.

**c. `[verify]` It's in the correct product queue:**
```bash
npm run queue:inspect
```
Expect the lead's category queue (Loans or SIP) `depth +1`, oldest-age ticking in working-time.

**d. `[HUMAN]`/`[verify]` Claim it** — as a telecaller, click **"Get next lead"** in
Pipeline → Leads, or:
```bash
curl -s -X POST https://pulse.finvastra.com/api/crm2/queue/claim \
  -H "Authorization: Bearer <telecaller-id-token>" -H "Content-Type: application/json" -d '{}'
```
Expect the returned lead = our lead; `npm run sla:inspect -- <leadId>` now shows `assigned`
stamped + owner + status `ASSIGNED`; `npm run queue:inspect` shows that queue `depth −1`.
> Two test reps? Fire two concurrent claims — they get **different** leads (atomic FIFO).

**e. `[verify]` Log first contact** — in the lead drawer set status → Attempted/Contacted (or
PATCH `{status:"ATTEMPTED"}`). `npm run sla:inspect -- <leadId>` → `firstContact` stamps
(Stage-2 clock stops).

**f. `[verify]` Controlled breach → manager alert.** Temporarily tighten the window, leave a
**second** test lead unclaimed, sweep, confirm the alert, then **restore**:
```bash
# (i) shrink WARM stage1 to 1 min (KEEP your real escalationUids in the doc):
#     app_config/sla.WARM.stage1Ms = 60000   (edit in Firebase Console)
# (ii) create/fire a second unclaimed test lead, then:
gcloud scheduler jobs run crm2-lead-sla-sweep --location=asia-south1
```
Confirm one **Stage-1 alert** reaches an `escalationUids` manager — **in-app bell AND email** —
and `npm run sla:inspect -- <secondLeadId>` shows `Stage-1 breach` stamped.
**(iii) RESTORE the real `app_config/sla`** (15 wm / 30 wm etc.) immediately after.

**g. `[verify]` Release back to queue:**
```bash
curl -s -X POST https://pulse.finvastra.com/api/crm2/queue/release \
  -H "Authorization: Bearer <owner-id-token>" -H "Content-Type: application/json" \
  -d '{"leadId":"<leadId>","reason":"smoke test"}'
```
`npm run sla:inspect -- <leadId>` → back unassigned, `releases: 1`, **captureAt unchanged**
(keeps its place); `npm run queue:inspect` shows it back in its queue.

**h. `[verify]` Dedup holds** — re-run the sweep; the already-breached lead emits **no second
alert** (the breach stamp + `crm2_reminder_logs` guard hold):
```bash
gcloud scheduler jobs run crm2-lead-sla-sweep --location=asia-south1
```

---

## 4. Cutover + cleanup `[deploy]` / `[HUMAN]`

1. **Retire the legacy Meta route** — once a real test lead has landed through the **new**
   webhook (3b green), merge the staged branch + redeploy:
   ```bash
   git checkout main && git merge --ff-only chore/remove-legacy-meta-intake
   npm run lint && npm test
   gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling
   ```
   (Until merged, `/api/leads/intake/meta` returns a harmless 200 — no gap. `processInboundLead`
   stays; the website intake uses it. See `docs/meta-webhook/legacy-cutover.md`.)
2. **Delete test data** — remove the 3f test leads; **re-confirm** real `app_config/sla`
   (windows + `escalationUids`), `app_config/business_hours`, `app_config/queues` are in place
   (`npm run queue:inspect` + `npm run sla:inspect` on a known lead).
3. Confirm both scheduler jobs are **ENABLED** (`gcloud scheduler jobs describe …`).

### Go / no-go (one screen)
- [ ] `verify:deploy` 3/3 green; all indexes READY.
- [ ] Four `META_*` env vars set; `META_GRAPH_BASE` **unset**; `GOOGLE_SA_JSON_BASE64` present.
- [ ] Handshake → `PING`; unsigned POST → 403.
- [ ] `app_config/sla` has real windows **+ `escalationUids`**; `business_hours` + `queues` confirmed.
- [ ] Real test lead: landed (3b) → in correct queue (3c) → claimed (3d) → first-contact (3e).
- [ ] Controlled breach alerted a manager in-app **and** email (3f) → **real SLA config restored**.
- [ ] Release preserved captureAt (3g); sweep dedup holds (3h).
- [ ] Both scheduler jobs ENABLED; Page subscribed to `leadgen`; System User token valid.

### Rollback
- **Stop intake fast:** rotate/unset `META_VERIFY_TOKEN` (breaks the handshake) or pause the
  Page's `leadgen` subscription in Meta — new deliveries stop; nothing in-flight is lost
  (write-ahead `meta_lead_events` + the retry job drain after recovery).
- **Pause automation:** `gcloud scheduler jobs pause crm2-meta-retry crm2-lead-sla-sweep --location=asia-south1`
  (the queue endpoints are request-driven and unaffected).
- **Bad revision:** `gcloud run services update-traffic pulse-api --region asia-south1 --to-revisions=<previous-revision>=100`.
- In-flight leads survive a redeploy (Firestore is the source of truth); the sweep + meta-retry
  reconcile once the good revision is live.

---

### Reference
- Meta webhook deep-dive + dead-letter alert policy: `docs/meta-webhook/GO-LIVE.md` (now
  superseded for sequencing by this doc; keep for the §5 alert command + Meta setup detail).
- Legacy cutover: `docs/meta-webhook/legacy-cutover.md`.
- Helpers: `npm run qa:meta:inspect -- <leadgen_id>` · `npm run sla:inspect -- <leadId>` ·
  `npm run queue:inspect` (all need `PULSE_ADMIN_TOKEN` / `META_ADMIN_TOKEN`).
