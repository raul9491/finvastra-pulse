# Meta Lead Ads → Pulse CRM webhook (Phase 1: capture + queue)

Receives Meta Lead Ads leads in real time and lands them as **CRM 2.0 leads**
(`source: ADS`, `status: NEW`) in the Pipeline → Leads list. Phase 1 is **capture +
queue only** — routing (RM assignment) and the contact-within-SLA timer are **Phase 2**.

> Launch gate: no ad budget goes live until a test lead flows
> **capture → queue → (Phase 2) route → contact-within-SLA**, verified end to end.

## How it works

Meta's webhook delivers only a `leadgen_id` — never the answers. So:

1. **`GET /api/webhooks/meta/leadgen`** — subscription handshake. Echoes `hub.challenge`
   when `hub.verify_token` matches `META_VERIFY_TOKEN`; else `403`.
2. **`POST /api/webhooks/meta/leadgen`** — signed delivery:
   - Verifies `X-Hub-Signature-256` = `sha256=HMAC(rawBody, META_APP_SECRET)` with a
     constant-time compare over the **raw bytes**. Bad/missing signature → `403`.
   - **Persist-first**: writes a write-ahead doc `meta_lead_events/{leadgen_id}`
     (`status: pending`) *before* ACK, so a crash never loses an event.
   - **ACK fast** (`200`), then processes asynchronously (Cloud Run runs with
     `--no-cpu-throttling`, so post-response work keeps CPU).
3. **Async worker `processMetaLeadgen`**:
   - Pulls the full lead from the Graph API:
     `GET /{META_GRAPH_VERSION}/{leadgen_id}?fields=field_data,...&access_token=…`
   - Maps fields defensively (alias-tolerant: `full_name`/`first_name`+`last_name`,
     `phone_number`/`mobile`/…, `email`, `city`); normalises the phone (+91 strip).
   - Upserts a CRM 2.0 lead in **one transaction guarded on the event doc** →
     no duplicate lead on redelivery/retry. Soft person-dedup **flags**
     (`duplicateOfLeadId`) but never drops.
   - Advances the event `pending → fetching → done` (or `failed` with `lastError`;
     `terminal: true` after 5 attempts or for an unusable lead).
   - Writes a row to `webhook_logs` (`source: social_meta`, result success/duplicate/invalid/error).
4. **`POST /api/crm2/jobs/run-meta-retry`** (Cloud Scheduler OIDC or admin) — reprocesses
   `pending` / non-terminal `failed` / stuck `fetching` events.

### Idempotency & durability
- Event doc id = `leadgen_id` → redelivered webhooks are not re-queued.
- Lead creation is transactional on the event doc → exactly one lead per `leadgen_id`.
- Lost-after-ACK events are recovered by the retry job.

## Required env (Cloud Run `pulse-api`) — secrets, never commit
| Var | What |
|---|---|
| `META_VERIFY_TOKEN` | String you also enter in Meta's webhook UI (handshake). |
| `META_APP_SECRET` | Meta App Secret — HMAC key for signature verification. **The security boundary.** |
| `META_PAGE_ACCESS_TOKEN` | **Long-lived System User** token with `leads_retrieval` + `pages_manage_metadata`. |
| `META_GRAPH_VERSION` | Graph API version for the pull, e.g. `v23.0`. |

```bash
gcloud run services update pulse-api --region asia-south1 --update-env-vars \
  "META_VERIFY_TOKEN=…,META_APP_SECRET=…,META_PAGE_ACCESS_TOKEN=…,META_GRAPH_VERSION=v23.0"
```

## Meta-side setup
1. App Dashboard → **Webhooks** → Page → subscribe to the **`leadgen`** field.
2. Callback URL `https://pulse.finvastra.com/api/webhooks/meta/leadgen`, Verify Token =
   `META_VERIFY_TOKEN`.
3. Subscribe the **Page** to the app (`/{page-id}/subscribed_apps` with `leadgen`).
4. Grant the System User token `leads_retrieval` + `pages_manage_metadata`.

## Local / manual test
Sign the sample payload and POST it (the signature MUST be over the exact bytes sent):

```bash
SECRET='your-meta-app-secret'
BODY="$(cat docs/meta-webhook/sample-leadgen-webhook.json)"
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -sS -X POST http://localhost:3000/api/webhooks/meta/leadgen \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  --data-binary "$BODY"
# → {"ok":true,"received":1,"queued":1}
```
(The async Graph pull needs a real `META_PAGE_ACCESS_TOKEN` + a real `leadgen_id`;
with the sample id the event lands as `failed` — expected. The signature/handshake/
persist path is what this exercises locally.)

Handshake:
```bash
curl "http://localhost:3000/api/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=PING"
# → PING
```

## Scheduler (register at deploy)
```bash
gcloud scheduler jobs create http crm2-meta-retry --location=asia-south1 \
  --schedule="*/10 * * * *" \
  --uri="https://pulse-api-787616231546.asia-south1.run.app/api/crm2/jobs/run-meta-retry" \
  --oidc-service-account-email="787616231546-compute@developer.gserviceaccount.com" \
  --http-method=POST --headers="Content-Type=application/json" --message-body='{}'
```

## Out of scope (Phase 2+)
- RM routing / round-robin assignment + the contact-within-SLA timer.
- Backfill of historical leads (webhooks are forward-only; a one-off
  `GET /{form_id}/leads` pull within Meta's ~90-day retention is a separate task).
