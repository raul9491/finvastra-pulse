# Finvastra Monthly MIS Report

Python script that exports Firestore commission data to Google Sheets.
Runs independently of the React app — no Node.js required.

## What it produces

| Sheet | Contents |
|---|---|
| Summary | Total expected vs received commission + variance % for the month |
| By Bank | Per-bank expected vs received breakdown |
| RM Payouts | Every RM's payout amount + status for the month |
| Discrepancies | All unresolved reconciliation discrepancies across open statements |

## Setup

### 1. Install dependencies
```bash
cd scripts/python
pip install -r requirements.txt
```

### 2. Service account
Create a service account in Google Cloud Console with:
- Firestore read access (or Firebase Admin SDK role)
- Google Sheets + Drive access (for writing to Sheets)

Download the JSON key and store it securely (never commit it).

### 3. Environment variables
Create a `.env` file in `scripts/python/` (gitignored):
```
GOOGLE_SA_KEY_PATH=/path/to/service-account-key.json
MIS_REPORT_SHEET_ID=your_google_sheet_id_here
```

Share the target Google Sheet with the service account email (Viewer + Editor).

### 4. Run
```bash
python monthly_mis_report.py 2026-05
```

## Scheduling

### Option A — Cloud Scheduler + Cloud Run Job
Deploy the script as a Cloud Run Job and trigger it via Cloud Scheduler
on the 1st of each month:
```
Schedule: 0 8 1 * *  (08:00 IST on the 1st)
```

### Option B — Cloud Scheduler + HTTP Cloud Function
Wrap in an HTTP Cloud Function, deploy, and point Cloud Scheduler at it.

### Option C — Cron on a VM
```bash
0 8 1 * * cd /path/to/scripts/python && python monthly_mis_report.py $(date +\%Y-\%m) >> /var/log/mis_report.log 2>&1
```

## Notes
- The script uses `collection_group` queries on the `lines` subcollection
  to find discrepancies — ensure the Firestore index for `lines.status`
  is deployed (`firestore.indexes.json` already includes it).
- Commission records are matched by `expectedPayoutDate` in the given month.
  Records received in a different month than expected will appear in that
  later month's report instead.
