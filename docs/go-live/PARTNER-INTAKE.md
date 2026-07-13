# Partner Intake — go-live runbook

The partner funnel (screening → scoring → onboarding) lives on the existing
Connector entity. Managed in **CRM → Masters → Connectors** (super-admin only).
A candidate is a Connector record from first inquiry; it moves through
`funnelStatus` (Inquiry → Screening → KYC Collection → Agreement Sent →
Agreement Signed → Training → **Active** | Rejected | On Hold) and stays
`status: inactive` (hidden from RMs' "Sourced by Connector" picker) until it
reaches **Active**.

## How to assess a candidate (the answer to "what do I ask them")
Open the candidate → **Screening** tab and fill the seven answers:
network type · network size · product/demand fit · prior track record ·
expected monthly volume · KYC readiness · whether they already hold a DSA code
elsewhere. Pulse shows the **Hot / Warm / Cold** tier with the per-factor
breakdown live (never a black box). Tier is a triage signal — you always decide
the stage manually (nothing is auto-rejected).

## Onboarding
The **Onboarding** tab tracks PAN/Aadhaar/bank collected, agreement sent/signed,
training, Pulse access, first case — with a progress bar. When you set the stage
to **Active**, the connector becomes pickable by RMs and can be attached to
cases exactly like any existing connector; DSA-code mapping + payout rules are
unchanged.

## Rubric
CRM → Masters → **Partner Scoring** (super-admin): edit the points per answer +
the Hot/Warm thresholds + the DSA-conflict penalty. Saving bumps the version and
re-scores every candidate that isn't already Active or Rejected.

## Website auto-intake (Phase 6 — the one human step)
The public endpoint is LIVE:

```
POST https://pulse.finvastra.com/api/public/partner-inquiry
Content-Type: application/json

{
  "name": "Ramesh Kumar",          // required, 2–120 chars
  "mobile": "9876543210",          // required, 10-digit Indian mobile
  "email": "ramesh@example.com",   // optional
  "firmName": "Ramesh Associates", // optional
  "leadSource": "Website Form",    // optional (defaults to Website Form)
  "occupation": "Practising CA",   // optional
  "networkType": "CA / Accountant",// optional (one of the screening options)
  "networkSize": ">100 contacts",  // optional
  "productInterestStated": "Home Loans, LAP", // optional
  "website": ""                    // HONEYPOT — leave empty; bots that fill it are silently dropped
}
```

A submission lands as an **Inquiry**-stage Connector (`status: inactive`),
scored by the current rubric, ready to screen in Masters → Connectors.

**To wire the finvastra.com "become a partner" form** (same pattern as the
website-leads intake):
1. In the site's Google Apps Script (or backend), POST the form fields to the
   URL above.
2. Send the trusted header `X-Finvastra-Webhook-Secret: <WEBSITE_WEBHOOK_SECRET>`
   so Apps-Script egress (shared Google IPs) bypasses the 20/hour per-IP rate
   limit. This is the SAME secret already set on Cloud Run for `/api/public/leads`.
3. Keep a hidden `website` field in the form and pass it through — it's the
   honeypot.

Browser-side posts (no secret) are still accepted, just rate-limited + honeypotted.
No new env var is needed — `WEBSITE_WEBHOOK_SECRET` already exists.

## Notes
- No AI — scoring is pure arithmetic against the editable rubric.
- PAN is now optional at create (a minimal Inquiry needs only name + mobile);
  collect KYC as the candidate progresses.
- `partnerScoring` and `onboardingChecklist.progressPct` are server-computed and
  cannot be set by a client.
