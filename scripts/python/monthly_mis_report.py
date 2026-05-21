"""
Finvastra Monthly MIS Report — Firestore → Google Sheets
Usage: python monthly_mis_report.py 2026-05

Reads commission_records, commission_statements, and rm_payouts for the
given month and writes a 4-sheet report to a Google Sheet.

Environment variables (in .env or shell):
  GOOGLE_SA_KEY_PATH   — path to service account JSON key file
  MIS_REPORT_SHEET_ID  — Google Sheet ID to write into
"""

import sys
import os
from datetime import datetime, date
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
import gspread
from google.oauth2.service_account import Credentials

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

SA_KEY_PATH    = os.environ["GOOGLE_SA_KEY_PATH"]
SHEET_ID       = os.environ["MIS_REPORT_SHEET_ID"]
SCOPES         = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── Init ──────────────────────────────────────────────────────────────────────

def init_firestore():
    if not firebase_admin._apps:
        cred = credentials.Certificate(SA_KEY_PATH)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def init_sheets():
    creds = Credentials.from_service_account_file(SA_KEY_PATH, scopes=SCOPES)
    gc    = gspread.authorize(creds)
    return gc.open_by_key(SHEET_ID)


# ── Data fetching ─────────────────────────────────────────────────────────────

def get_commission_records(db, month: str) -> list[dict]:
    """Load all commission_records whose expectedPayoutDate starts with the month."""
    from_date = f"{month}-01"
    to_date   = f"{month}-31"
    docs = (
        db.collection("commission_records")
        .where("expectedPayoutDate", ">=", from_date)
        .where("expectedPayoutDate", "<=", to_date)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_statements(db, month: str) -> list[dict]:
    """Load commission_statements whose periodStart matches the month."""
    docs = (
        db.collection("commission_statements")
        .where("periodStart", "==", month)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_rm_payouts(db, month: str) -> list[dict]:
    """Load rm_payouts for the period."""
    docs = (
        db.collection("rm_payouts")
        .where("periodStart", "==", month)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_providers(db) -> dict[str, str]:
    """Returns {providerId: providerName}."""
    return {d.id: d.to_dict().get("name", d.id) for d in db.collection("providers").stream()}


def get_discrepancy_lines(db) -> list[dict]:
    """Load all unresolved discrepancy lines across open statements."""
    # collection group query on lines subcollection
    docs = (
        db.collection_group("lines")
        .where("status", "==", "discrepancy")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ── Computation ───────────────────────────────────────────────────────────────

def compute_summary(records: list[dict], statements: list[dict]) -> dict:
    total_expected = sum(r.get("calculatedCommission", 0) for r in records)
    total_received = sum(
        s.get("totalAmount", 0)
        for s in statements
        if s.get("status") in ("reconciled", "closed", "discrepancy")
    )
    variance    = total_received - total_expected
    variance_pct = round(variance / total_expected * 100, 2) if total_expected else 0
    return {
        "total_expected": total_expected,
        "total_received": total_received,
        "variance":       variance,
        "variance_pct":   variance_pct,
    }


def by_bank(records: list[dict], providers: dict[str, str]) -> list[dict]:
    """Aggregate expected vs received per bank."""
    bank_data: dict[str, dict] = {}
    for r in records:
        pid  = r.get("providerId", "unknown")
        name = providers.get(pid, pid)
        if name not in bank_data:
            bank_data[name] = {"expected": 0, "received": 0}
        bank_data[name]["expected"] += r.get("calculatedCommission", 0)
        if r.get("status") == "paid":
            bank_data[name]["received"] += r.get("actualAmount") or r.get("calculatedCommission", 0)
    return [
        {"bank": k, "expected": v["expected"], "received": v["received"],
         "variance": v["received"] - v["expected"]}
        for k, v in sorted(bank_data.items())
    ]


def top_rms(payouts: list[dict], n: int = 5) -> list[dict]:
    sorted_payouts = sorted(payouts, key=lambda p: p.get("totalPayout", 0), reverse=True)
    return [
        {
            "rm":          p.get("rmDisplayName", p.get("rmId", "?")),
            "period":      p.get("periodStart", ""),
            "total_payout": p.get("totalPayout", 0),
            "status":      p.get("status", ""),
        }
        for p in sorted_payouts[:n]
    ]


# ── Sheet writing ─────────────────────────────────────────────────────────────

def fmt_inr(amount) -> str:
    return f"₹{amount:,.0f}"


def ensure_sheet(workbook, title: str):
    """Return an existing worksheet or create a new one."""
    try:
        ws = workbook.worksheet(title)
        ws.clear()
        return ws
    except gspread.WorksheetNotFound:
        return workbook.add_worksheet(title=title, rows=200, cols=20)


def write_summary(ws, month: str, summary: dict, run_at: str):
    ws.update("A1", [[f"MIS Report — {month}", "", "", ""]])
    ws.update("A2", [[f"Generated: {run_at}", "", "", ""]])
    ws.update("A4", [["Metric", "Amount (₹)"]])
    ws.update("A5", [
        ["Total Expected Commission",  fmt_inr(summary["total_expected"])],
        ["Total Received Commission",  fmt_inr(summary["total_received"])],
        ["Variance (Received - Expected)", fmt_inr(summary["variance"])],
        ["Variance %",                 f"{summary['variance_pct']}%"],
    ])


def write_by_bank(ws, rows: list[dict]):
    ws.update("A1", [["Bank", "Expected (₹)", "Received (₹)", "Variance (₹)"]])
    data = [[r["bank"], fmt_inr(r["expected"]), fmt_inr(r["received"]), fmt_inr(r["variance"])] for r in rows]
    if data:
        ws.update("A2", data)


def write_rm_payouts(ws, payouts: list[dict]):
    ws.update("A1", [["RM Name", "Period", "Total Payout (₹)", "Status"]])
    data = [
        [p.get("rmDisplayName", ""), p.get("periodStart", ""),
         fmt_inr(p.get("totalPayout", 0)), p.get("status", "")]
        for p in sorted(payouts, key=lambda x: x.get("rmDisplayName", ""))
    ]
    if data:
        ws.update("A2", data)


def write_discrepancies(ws, lines: list[dict]):
    ws.update("A1", [["Statement ID", "Date", "Description", "Statement Amount (₹)", "Discrepancy (₹)"]])
    data = [
        [l.get("statementId", ""), l.get("parsedDate", ""), l.get("rawDescription", "")[:60],
         fmt_inr(l.get("parsedAmount", 0)), fmt_inr(l.get("discrepancyAmount", 0))]
        for l in lines
    ]
    if data:
        ws.update("A2", data)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python monthly_mis_report.py YYYY-MM")
        sys.exit(1)

    month = sys.argv[1]
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        print(f"Invalid month format: {month}. Use YYYY-MM.")
        sys.exit(1)

    run_at = datetime.now().strftime("%d %b %Y %H:%M")
    print(f"Generating MIS report for {month}…")

    db        = init_firestore()
    workbook  = init_sheets()
    providers = get_providers(db)

    records     = get_commission_records(db, month)
    statements  = get_statements(db, month)
    payouts     = get_rm_payouts(db, month)
    disc_lines  = get_discrepancy_lines(db)

    summary     = compute_summary(records, statements)
    bank_rows   = by_bank(records, providers)

    print(f"  Records: {len(records)}  Statements: {len(statements)}  "
          f"Payouts: {len(payouts)}  Discrepancies: {len(disc_lines)}")

    ws1 = ensure_sheet(workbook, "Summary")
    write_summary(ws1, month, summary, run_at)

    ws2 = ensure_sheet(workbook, "By Bank")
    write_by_bank(ws2, bank_rows)

    ws3 = ensure_sheet(workbook, "RM Payouts")
    write_rm_payouts(ws3, payouts)

    ws4 = ensure_sheet(workbook, "Discrepancies")
    write_discrepancies(ws4, disc_lines)

    print(f"  ✓ Report written to Sheet ID: {SHEET_ID}")
    print(f"  Expected: {fmt_inr(summary['total_expected'])}  "
          f"Received: {fmt_inr(summary['total_received'])}  "
          f"Variance: {fmt_inr(summary['variance'])} ({summary['variance_pct']}%)")


if __name__ == "__main__":
    main()
