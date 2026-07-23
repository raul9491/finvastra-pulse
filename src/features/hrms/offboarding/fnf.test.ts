import { describe, it, expect } from 'vitest';
import { computeFnF, parseFlexDate, type FnFInputs } from './fnf';

/**
 * The offboarding FnF settlement is the one piece of real money arithmetic in the
 * HRMS exit flow, and it had NO tests until it was extracted from the 1300-line
 * page component (2026-07-23). These lock in the CURRENT behaviour exactly — they
 * are a regression net for a refactor, not a re-derivation of policy.
 */

const base: FnFInputs = {
  grossSalary: '52000',
  workingDaysInLastMonth: '26',
  daysWorked: '13',
  earnedLeaveBalance: '0',
  joiningDateStr: '',
  lastWorkingDateStr: '',
  noticePeriodDays: '0',
  noticePeriodServed: '0',
  bonusAmount: '',
  fuelAmount: '',
  compOffDays: '',
  excessPaidRecovery: '',
  excessPaidRecoveryNotes: '',
  otherDeductions: '',
  otherDeductionNotes: '',
};
const f = (over: Partial<FnFInputs> = {}) => computeFnF({ ...base, ...over })!;

describe('parseFlexDate', () => {
  it('accepts DD-MM-YYYY', () => {
    expect(parseFlexDate('15-08-2020')?.toISOString().slice(0, 10)).toBe('2020-08-15');
  });
  it('accepts YYYY-MM-DD', () => {
    expect(parseFlexDate('2020-08-15')?.toISOString().slice(0, 10)).toBe('2020-08-15');
  });
  it('rejects anything else', () => {
    expect(parseFlexDate('15/08/2020')).toBeNull();
    expect(parseFlexDate('')).toBeNull();
  });
});

describe('computeFnF', () => {
  it('returns null when gross salary is not set — nothing to settle', () => {
    expect(computeFnF({ ...base, grossSalary: '0' })).toBeNull();
    expect(computeFnF({ ...base, grossSalary: '' })).toBeNull();
  });

  it('prorates salary on a daily rate of gross / working days', () => {
    const r = f();
    expect(r.dailyRate).toBe(2000);          // 52000 / 26
    expect(r.salaryForDaysWorked).toBe(26000); // 2000 x 13
    expect(r.totalPayable).toBe(26000);
  });

  it('defaults working days to 26 when blank', () => {
    expect(f({ workingDaysInLastMonth: '' }).workingDaysInLastMonth).toBe(26);
  });

  it('encashes earned leave at the daily rate, capped at 30 days', () => {
    expect(f({ earnedLeaveBalance: '10' }).leaveEncashmentAmount).toBe(20000);
    // 45 days of balance is still only 30 days of encashment
    expect(f({ earnedLeaveBalance: '45' }).leaveEncashmentAmount).toBe(60000);
  });

  it('pays gratuity ONLY at 5+ years of tenure', () => {
    const under = f({ joiningDateStr: '01-04-2022', lastWorkingDateStr: '31-03-2026' });
    expect(under.gratuityApplicable).toBe(false);
    expect(under.gratuityAmount).toBe(0);

    // basic = gross x 0.4 = 20800; (20800 / 26) x 15 x 5 = 60000
    const over = f({ joiningDateStr: '01-04-2020', lastWorkingDateStr: '01-04-2025' });
    expect(over.gratuityApplicable).toBe(true);
    expect(over.gratuityAmount).toBe(60000);
  });

  it('does not pay gratuity when either date is missing', () => {
    expect(f({ joiningDateStr: '01-04-2010' }).gratuityApplicable).toBe(false);
  });

  it('deducts only the UNSERVED part of the notice period', () => {
    expect(f({ noticePeriodDays: '30', noticePeriodServed: '30' }).noticePeriodDeduction).toBe(0);
    expect(f({ noticePeriodDays: '30', noticePeriodServed: '20' }).noticePeriodDeduction).toBe(20000);
    // over-served must never become a bonus
    expect(f({ noticePeriodDays: '30', noticePeriodServed: '40' }).noticePeriodDeduction).toBe(0);
  });

  it('adds bonus, fuel and comp-off; subtracts recovery and other deductions', () => {
    const r = f({
      bonusAmount: '5000', fuelAmount: '2000', compOffDays: '2',
      excessPaidRecovery: '1500', otherDeductions: '500',
    });
    expect(r.compOffEncashmentAmount).toBe(4000);   // 2 x 2000
    // 26000 + 5000 + 2000 + 4000 - 1500 - 500
    expect(r.totalPayable).toBe(35000);
  });

  it('nets everything together, and can go negative when deductions exceed dues', () => {
    const r = f({ daysWorked: '2', noticePeriodDays: '30', noticePeriodServed: '0' });
    // 4000 salary - 60000 notice
    expect(r.totalPayable).toBe(-56000);
  });

  it('omits optional extras rather than reporting them as zero', () => {
    const r = f();
    expect(r.bonusAmount).toBeUndefined();
    expect(r.fuelAmount).toBeUndefined();
    expect(r.compOffEncashmentAmount).toBeUndefined();
    expect(r.excessPaidRecovery).toBeUndefined();
  });
});
