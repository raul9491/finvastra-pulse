/**
 * leaveYearResetJob — year-end leave balance reset.
 *
 * Run on April 1 each year (Cloud Scheduler) or manually by an admin.
 * Creates a new leave_balances/{empId}_{year} doc for each active employee
 * using the HR Handbook reset rules:
 *   CL → 8   (no carry-forward)
 *   SL → 7   (no carry-forward)
 *   EL → min(prev EL remaining, 30) + 15  (carry-forward capped at 30, then add 15 new)
 *   Comp Off → 0  (reset; new credits granted separately via AdminCompOffPage)
 *
 * The `year` parameter is the FY start year (e.g. 2026 for FY 2026-27).
 * Reads previous year's EL from leave_balances/{empId}_{year-1}.
 * Writes adjustment audit records to leave_balance_adjustments.
 * Writes a summary to leave_year_resets/{year}.
 */

import * as admin from "firebase-admin";

interface BalanceTier {
  total:     number;
  used:      number;
  remaining: number;
}

interface NewBalance {
  employeeId: string;
  year:       number;
  casual:     BalanceTier;
  sick:       BalanceTier;
  earned:     BalanceTier;
  // comp_off intentionally omitted — resets to zero / not present
}

export async function runLeaveYearReset(
  db:              admin.firestore.Firestore,
  year:            number,
  triggeredBy:     string,
  triggeredByName: string,
): Promise<{ ok: boolean; employeesProcessed: number; errors: string[] }> {

  const prevYear = year - 1;
  const errors:  string[] = [];
  let   processed = 0;

  // Fetch all employees (active employees only)
  const usersSnap = await db.collection("users").get();
  const employees = usersSnap.docs.filter((d) => {
    const data = d.data();
    // Skip inactive employees and accounts without email (incomplete setups)
    return data.employeeStatus !== "inactive" && !!data.email;
  });

  for (const empDoc of employees) {
    const empId = empDoc.id;
    try {
      // Read previous year's balance for EL carry-forward
      const prevBalSnap = await db
        .collection("leave_balances")
        .doc(`${empId}_${prevYear}`)
        .get();

      const prevBal = prevBalSnap.exists ? prevBalSnap.data() : null;
      const prevElRemaining: number = prevBal?.earned?.remaining ?? 0;
      const elCarryForward = Math.min(prevElRemaining, 30);   // cap at 30 days
      const newElTotal     = elCarryForward + 15;             // 15 new days always added

      const newBal: NewBalance = {
        employeeId: empId,
        year,
        casual:  { total: 8,          used: 0, remaining: 8 },
        sick:    { total: 7,          used: 0, remaining: 7 },
        earned:  { total: newElTotal, used: 0, remaining: newElTotal },
        // comp_off: intentionally absent → resets to zero
      };

      // Upsert the new year's balance (overwrite if already exists)
      await db
        .collection("leave_balances")
        .doc(`${empId}_${year}`)
        .set(newBal, { merge: false });

      // Audit trail
      await db.collection("leave_balance_adjustments").add({
        employeeId:      empId,
        year,
        type:            "year_end_reset",
        prevYear,
        elCarryForward,
        before: prevBal
          ? {
              casual:   prevBal.casual   ?? null,
              sick:     prevBal.sick     ?? null,
              earned:   prevBal.earned   ?? null,
              comp_off: prevBal.comp_off ?? null,
            }
          : null,
        after: newBal,
        adjustedBy:     triggeredBy,
        adjustedByName: triggeredByName,
        adjustedAt:     admin.firestore.FieldValue.serverTimestamp(),
        notes:          `Year-end reset FY${year}`,
      });

      processed++;
    } catch (e) {
      errors.push(`${empId}: ${String(e)}`);
    }
  }

  // Summary record (acts as "done" flag for this year)
  await db.collection("leave_year_resets").doc(String(year)).set({
    year,
    resetAt:            admin.firestore.FieldValue.serverTimestamp(),
    resetBy:            triggeredBy,
    resetByName:        triggeredByName,
    employeesProcessed: processed,
    errorCount:         errors.length,
    notes:              null,
  });

  return { ok: true, employeesProcessed: processed, errors };
}
