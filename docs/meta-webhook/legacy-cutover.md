# Legacy `/api/leads/intake/meta` cutover — STAGED, do not run yet

The old Meta intake (`GET|POST /api/leads/intake/meta` in `server.ts`) is **broken and
superseded** by `/api/webhooks/meta/leadgen` (in `server/crm2.ts`). It never worked: it
skipped real webhooks with `if (!val?.field_data) continue;` (Meta only sends a
`leadgen_id`, never inline `field_data`) and its verify token was unset. It currently just
returns `200` and writes nothing — harmless, so there is **no rush** to remove it.

## When to run
**Only AFTER a real test lead has landed through the new endpoint** (GO-LIVE.md step 8 green).
Until then the legacy route is the no-op fallback that guarantees no gap.

## What the cutover removes
- `GET /api/leads/intake/meta` handler (the old handshake).
- `POST /api/leads/intake/meta` handler (the old, broken intake).
- Leaves `processInboundLead` **in place** — the website intake
  (`POST /api/leads/intake/website`) still uses it. Only the Meta wiring goes.

## How it's staged
The removal lives on an **unmerged branch** so nothing changes on `main` until you decide:

```bash
git fetch origin
git checkout chore/remove-legacy-meta-intake   # the removal commit
# review, then merge when GO-LIVE step 8 is green:
git checkout main && git merge --ff-only chore/remove-legacy-meta-intake
npm run lint && npm test
# deploy: gcloud run deploy pulse-api --source . --region asia-south1 --no-cpu-throttling
```

If the branch is unavailable, the change is mechanical: delete the two `app.*("/api/leads/intake/meta", …)`
blocks in `server.ts` (the `// ─── GET /api/leads/intake/meta …` and
`// ─── POST /api/leads/intake/meta …` sections). Also drop the now-unused
`META_WEBHOOK_SECRET` env var (the new flow uses `META_VERIFY_TOKEN` + `META_APP_SECRET`).
