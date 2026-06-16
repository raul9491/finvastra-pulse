# Meta Lead Ads webhook — GO-LIVE runbook

Ordered steps to take the Phase 1 (capture + queue) webhook to production and verify a
real test lead. Steps are tagged:
- **`[deploy]`** — a machine step (run the command).
- **`[HUMAN]`** — must be done by a person in the Meta / Google consoles.
- **`[verify]`** — a check that must pass before moving on.

> Launch gate: **do not turn on ad budget** until a real test lead has flowed
> capture → queue and (Phase 2) route → contact-within-SLA. Phase 1 proves the first half.

---

## 0. Pre-flight — env-var checklist `[HUMAN]`
All four are **secrets / config — never commit**. Set on Cloud Run (`pulse-api`, `asia-south1`):

| Var | Where it comes from | Notes |
|---|---|---|
| `META_VERIFY_TOKEN` | You invent it; also typed into Meta's webhook UI | handshake only |
| `META_APP_SECRET` | Meta App Dashboard → Settings → Basic → **App Secret** | HMAC key — **the security boundary** |
| `META_PAGE_ACCESS_TOKEN` | **System User** token (Business Settings → System Users) with `leads_retrieval` + `pages_manage_metadata` | **long-lived** — a 60-day Page token will expire |
| `META_GRAPH_VERSION` | e.g. `v23.0` | pin deliberately |

```bash
gcloud run services update pulse-api --region asia-south1 --update-env-vars \
  "META_VERIFY_TOKEN=…,META_APP_SECRET=…,META_PAGE_ACCESS_TOKEN=…,META_GRAPH_VERSION=v23.0"
```
> Do **not** set `META_GRAPH_BASE` in production — it must default to `https://graph.facebook.com`.
> It exists only so the emulator gate can point at a local mock.

## 1. Pre-deploy gate `[verify]`
```bash
npm run lint && npm test && npm run qa:meta
```
All green = signature/idempotency/recovery/terminal proven offline.

## 2. Deploy rules + server + hosting `[deploy]`
```bash
npm run deploy:rules          # adds meta_lead_events + meta_lead_deadletters blocks
npm run verify:deploy          # confirm rules bound to `pulse` (1 of the 3 checks)
gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling
npm run deploy                 # hosting (unaffected, but keeps the bundle current)
npm run verify:deploy          # 3/3 green
```
> `--no-cpu-throttling` is **required** — the webhook ACKs fast then does the Graph
> pull post-response; a throttled container would starve that work.

## 3. Endpoint smoke test `[verify]`
```bash
# Handshake (replace the token):
curl "https://pulse.finvastra.com/api/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=PING"
# → PING   (403 means the token in env ≠ the one you passed)

# Unsigned POST must be rejected:
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://pulse.finvastra.com/api/webhooks/meta/leadgen \
  -H "Content-Type: application/json" --data '{"object":"page","entry":[]}'
# → 403
```

## 4. Register the retry scheduler `[deploy]`
```bash
gcloud scheduler jobs create http crm2-meta-retry --location=asia-south1 \
  --schedule="*/10 * * * *" \
  --uri="https://pulse-api-787616231546.asia-south1.run.app/api/crm2/jobs/run-meta-retry" \
  --oidc-service-account-email="787616231546-compute@developer.gserviceaccount.com" \
  --http-method=POST --headers="Content-Type=application/json" --message-body='{}'
# smoke: gcloud scheduler jobs run crm2-meta-retry --location=asia-south1   (expect Cloud Run 200)
```

## 5. Dead-letter alert policy `[deploy]` (document; apply when ready)
A `terminal` event emits an error-severity structured log
(`jsonPayload.event="meta_lead_deadletter"`). Create a log-based alert so ops is paged:

```bash
# 1) Log-based metric on the dead-letter marker:
gcloud logging metrics create meta_lead_deadletter \
  --description="Meta leadgen events that exhausted retries / are unusable" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="pulse-api" AND jsonPayload.event="meta_lead_deadletter" AND severity>=ERROR'

# 2) Alert policy on that metric (>0 in a 10-min window). Reuse an existing
#    notification channel id (list: `gcloud alpha monitoring channels list`):
gcloud alpha monitoring policies create \
  --notification-channels="<CHANNEL_ID>" \
  --display-name="Meta leadgen dead-letters" \
  --condition-display-name="dead-letter > 0 (10m)" \
  --condition-filter='metric.type="logging.googleapis.com/user/meta_lead_deadletter" AND resource.type="cloud_run_revision"' \
  --condition-threshold-value=0 --condition-threshold-comparison=COMPARISON_GT \
  --condition-threshold-duration=600s --combiner=OR
```
> Admins can also read the `meta_lead_deadletters` collection directly for an ops view.

## 6. Meta-side wiring `[HUMAN]`
1. **App Dashboard → Webhooks → Page** → add subscription, callback URL
   `https://pulse.finvastra.com/api/webhooks/meta/leadgen`, verify token = `META_VERIFY_TOKEN`.
2. Subscribe to the **`leadgen`** field.
3. Subscribe the **Page** to the app (Graph: `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`),
   and confirm with `GET /{page-id}/subscribed_apps`.
4. Ensure the System User token has `leads_retrieval` + `pages_manage_metadata` on that Page.
5. **The Instant Form MUST include a product question** (e.g. "Which product?" →
   Home Loan / LAP / Personal Loan / SIP / Insurance). Phase 2 routing depends on it;
   step 8 fails loudly if it's missing.

## 7. Fire a test lead `[HUMAN]`
Meta **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing) → pick the
Page + Form → **Create Lead**. Note the returned `leadgen_id`.

## 8. Verify it landed `[verify]`
```bash
# META_ADMIN_TOKEN = a Firebase ID token for an admin (browser devtools of a signed-in admin).
META_ADMIN_TOKEN="<id-token>" npm run qa:meta:inspect -- <leadgen_id>
```
Expect: event `status: done`, a printed CRM 2.0 lead (`source: ADS`, `status: NEW`), and
`✓ product interest captured`. A non-zero exit + `✗ BLOCKER …` means the Instant Form has
no product question — fix step 6.5 and re-fire. Also confirm the lead is visible in
**Pipeline → Leads**.

---

## Rollback
- **Disable intake fast:** unset/rotate `META_VERIFY_TOKEN` (breaks the handshake) or pause
  the Page's `leadgen` subscription in Meta. New deliveries stop; nothing is lost.
- **Bad deploy:** `gcloud run services update-traffic pulse-api --region asia-south1 --to-revisions=<previous-revision>=100`.
- The legacy `/api/leads/intake/meta` route still returns 200 and is untouched until the
  staged cutover (see `docs/meta-webhook/legacy-cutover.md`) is run — so there is no gap.
- In-flight events survive a redeploy (write-ahead `meta_lead_events`); the retry job
  (step 4) drains anything stuck after the new revision is live.

## Env-var checklist (quick copy)
`META_VERIFY_TOKEN` · `META_APP_SECRET` · `META_PAGE_ACCESS_TOKEN` · `META_GRAPH_VERSION`
(and **never** `META_GRAPH_BASE` in prod).
