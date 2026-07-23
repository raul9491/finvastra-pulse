/**
 * Full-and-final settlement arithmetic — pure, deterministic, no React.
 * 
 * Extracted from OffboardingPage.tsx (2026-07-23). It lived inside a 1300-line
 * page component, which meant the one piece of real money arithmetic in the
 * offboarding flow had NO tests. Pulling it out unchanged makes it testable;
 * see fnf.test.ts.
 * 
 * Rules encoded here (unchanged):
 *   dailyRate        = gross / workingDaysInLastMonth (default 26)
 *   leave encashment = min(earnedLeave, 30) x dailyRate   (earned only, cap 30)
 *   gratuity         = round((basic / 26) x 15 x tenureYears), ONLY if tenure >= 5y
 *                      basic is approximated as gross x 0.4 when not supplied
 *   notice deduction = max(0, noticeDays - noticeServed) x dailyRate
 *   net              = salary + encashments + gratuity + bonus + fuel
 *                      - notice - excess recovery - other deductions
 */
import { differenceInYears } from 'date-fns';
import type { FnFDetails } from '../../../types';

// ─── FnF Calculator ───────────────────────────────────────────────────────────

export interface FnFInputs {
  grossSalary: string;
  workingDaysInLastMonth: string;
  daysWorked: string;
  earnedLeaveBalance: string;
  joiningDateStr: string;       // DD-MM-YYYY or YYYY-MM-DD
  lastWorkingDateStr: string;   // DD-MM-YYYY or YYYY-MM-DD
  noticePeriodDays: string;
  noticePeriodServed: string;
  // Extras
  bonusAmount: string;
  fuelAmount: string;
  compOffDays: string;
  excessPaidRecovery: string;
  excessPaidRecoveryNotes: string;
  // Standard deductions
  otherDeductions: string;
  otherDeductionNotes: string;
}

/** Parse DD-MM-YYYY or YYYY-MM-DD into a Date */
export function parseFlexDate(s: string): Date | null {
  if (!s) return null;
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmm) return new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`);
  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return new Date(s);
  return null;
}

export function computeFnF(inputs: FnFInputs): FnFDetails | null {
  const gross = parseFloat(inputs.grossSalary) || 0;
  const workDays = parseFloat(inputs.workingDaysInLastMonth) || 26;
  const daysWorked = parseFloat(inputs.daysWorked) || 0;
  const earnedLeave = parseFloat(inputs.earnedLeaveBalance) || 0;
  const noticeDays = parseFloat(inputs.noticePeriodDays) || 0;
  const noticeServed = parseFloat(inputs.noticePeriodServed) || 0;
  const bonusAmt = parseFloat(inputs.bonusAmount) || 0;
  const fuelAmt = parseFloat(inputs.fuelAmount) || 0;
  const compOffDays = parseFloat(inputs.compOffDays) || 0;
  const excessRecovery = parseFloat(inputs.excessPaidRecovery) || 0;
  const otherDed = parseFloat(inputs.otherDeductions) || 0;

  if (gross <= 0) return null;

  const basic = gross * 0.4; // approximate when separate basic not available

  const dailyRate = gross / workDays;
  const salaryForDaysWorked = dailyRate * daysWorked;

  // Leave encashment: earned only, capped at 30 days
  const cappedLeave = Math.min(earnedLeave, 30);
  const leaveEncashmentAmount = cappedLeave * dailyRate;

  // Comp Off encashment: at daily rate
  const compOffEncashmentAmount = compOffDays * dailyRate;

  // Gratuity: only if tenure >= 5 years
  const joiningDate = parseFlexDate(inputs.joiningDateStr);
  const lwdDate = parseFlexDate(inputs.lastWorkingDateStr);
  let gratuityApplicable = false;
  let gratuityAmount = 0;
  let tenureYears = 0;
  if (joiningDate && lwdDate) {
    tenureYears = differenceInYears(lwdDate, joiningDate);
    gratuityApplicable = tenureYears >= 5;
    if (gratuityApplicable) {
      // Gratuity = (basic / 26) × 15 × years of service
      gratuityAmount = Math.round((basic / 26) * 15 * tenureYears);
    }
  }

  // Notice period deduction: shortfall × daily rate
  const shortfall = Math.max(0, noticeDays - noticeServed);
  const noticePeriodDeduction = shortfall * dailyRate;

  const totalPayable =
    salaryForDaysWorked + leaveEncashmentAmount + gratuityAmount
    + bonusAmt + fuelAmt + compOffEncashmentAmount
    - noticePeriodDeduction - excessRecovery - otherDed;

  return {
    grossSalary: gross,
    workingDaysInLastMonth: workDays,
    daysWorked,
    dailyRate,
    salaryForDaysWorked,
    earnedLeaveBalance: earnedLeave,
    leaveEncashmentAmount,
    gratuityApplicable,
    gratuityAmount,
    noticePeriodDays: noticeDays,
    noticePeriodServed: noticeServed,
    noticePeriodDeduction,
    bonusAmount: bonusAmt || undefined,
    fuelAmount: fuelAmt || undefined,
    compOffDays: compOffDays || undefined,
    compOffEncashmentAmount: compOffDays ? compOffEncashmentAmount : undefined,
    excessPaidRecovery: excessRecovery || undefined,
    excessPaidRecoveryNotes: inputs.excessPaidRecoveryNotes.trim() || undefined,
    otherDeductions: otherDed,
    otherDeductionNotes: inputs.otherDeductionNotes,
    totalPayable,
    finalizedAt: null,
    finalizedBy: null,
    statementGeneratedAt: null,
  };
}
