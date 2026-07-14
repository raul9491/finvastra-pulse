# Partner Intake — go-live runbook

**The flow (lead-first, revised 2026-07-14):**
1. Partner inquiries (website /partner page, WhatsApp, walk-in) land on the
   **Leads page** as category **"Partner Sign-up"** — no CON- code is spent yet.
2. The **initial call/screening happens on the lead** like any contact (call
   logging, dispositions, follow-ups all work normally).
3. If qualified, use **"Move to Partner funnel"** in the lead drawer — THAT
   mints the next CON- code and creates the candidate in CRM → Masters →
   Connectors (super-admin area), where the deep screening questionnaire,
   practical assessment, and onboarding checklist run.
4. Moved someone too early? **"↩ Return to Leads"** on the Connectors row sends
   them back and frees the code.
5. Activation is gated: practical assessment passed + agreement signed + PAN
   collected — only then can the stage be set to **Active**, which makes the
   partner pickable by RMs on real cases.

Super admins get a bell + email when a candidate is moved into Connectors and
when a scheduled candidate follow-up falls due.

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

A submission lands as a **"Partner Sign-up" LEAD** on the Leads page — screened
there first; a CON- code is minted only on the manual move to Masters.

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
