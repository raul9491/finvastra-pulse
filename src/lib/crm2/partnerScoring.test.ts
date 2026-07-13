import { describe, it, expect } from 'vitest';
import {
  computePartnerScore, computeOnboardingProgress, sanitizePartnerRubric,
  DEFAULT_PARTNER_RUBRIC, type PartnerRubric,
} from './partnerScoring';

const R = DEFAULT_PARTNER_RUBRIC;

describe('computePartnerScore', () => {
  it('scores a strong candidate as Hot (>= hot threshold)', () => {
    const s = computePartnerScore({
      networkType: 'CA / Accountant',        // 3
      networkSize: '>100 contacts',          // 3
      productDemandFit: 'Strong Fit',        // 3
      priorTrackRecord: 'Proven with Examples', // 3
      expectedMonthlyVolume: '>5 cases/month',  // 3
      kycReadinessInput: 'Ready',            // 2
      existingDsaCodeElsewhere: false,
    }, R);
    expect(s.totalScore).toBe(17);
    expect(s.tier).toBe('Hot');
    expect(s.rubricVersion).toBe(R.version);
  });

  it('scores a middling candidate as Warm', () => {
    const s = computePartnerScore({
      networkType: 'Insurance Agent',        // 2
      networkSize: '30-100 contacts',        // 2
      productDemandFit: 'Partial Fit',       // 2
      priorTrackRecord: 'None',              // 1
      expectedMonthlyVolume: 'Not Shared',   // 0
      kycReadinessInput: 'Partial',          // 1
    }, R);
    expect(s.totalScore).toBe(8);            // >= warm(7), < hot(12)
    expect(s.tier).toBe('Warm');
  });

  it('scores a weak candidate as Cold', () => {
    const s = computePartnerScore({
      networkType: 'Other / Unclear',        // 0
      networkSize: 'Not Shared',             // 0
      productDemandFit: 'Unclear',           // 1
      priorTrackRecord: 'None',              // 1
      expectedMonthlyVolume: '<2 cases/month', // 1
      kycReadinessInput: 'Not Ready',        // 0
    }, R);
    expect(s.totalScore).toBe(3);
    expect(s.tier).toBe('Cold');
  });

  it('applies the conflict penalty when a DSA code exists elsewhere', () => {
    const base = {
      networkType: 'CA / Accountant', networkSize: '>100 contacts',
      productDemandFit: 'Strong Fit', priorTrackRecord: 'Some Experience',
      expectedMonthlyVolume: '2-5 cases/month', kycReadinessInput: 'Ready',
    } as const;
    const clean = computePartnerScore({ ...base, existingDsaCodeElsewhere: false }, R);
    const conflicted = computePartnerScore({ ...base, existingDsaCodeElsewhere: true }, R);
    expect(conflicted.conflictPenalty).toBe(-2);
    expect(conflicted.totalScore).toBe(clean.totalScore - 2);
  });

  it('treats missing / unknown answers as 0', () => {
    const s = computePartnerScore({}, R);
    expect(s.totalScore).toBe(0);
    expect(s.tier).toBe('Cold');
    const bad = computePartnerScore({ networkType: 'Nonexistent' as never }, R);
    expect(bad.networkTypeScore).toBe(0);
  });

  it('honours custom tier thresholds', () => {
    const rubric: PartnerRubric = { ...R, tierThresholds: { hot: 5, warm: 3 } };
    const s = computePartnerScore({ networkType: 'CA / Accountant', networkSize: '30-100 contacts' }, rubric); // 3+2=5
    expect(s.tier).toBe('Hot');
  });
});

describe('computeOnboardingProgress', () => {
  it('is 0 for an empty checklist and 100 for all 7 done', () => {
    expect(computeOnboardingProgress(null)).toBe(0);
    expect(computeOnboardingProgress({})).toBe(0);
    expect(computeOnboardingProgress({
      panCollected: true, aadhaarCollected: true, bankDetailsCollected: true,
      agreementSignedDate: { toMillis: () => 1 }, trainingCompleted: true,
      pulseAccessCreated: true, firstCaseLogged: true,
    })).toBe(100);
  });

  it('rounds partial progress (3 of 7 ≈ 43)', () => {
    expect(computeOnboardingProgress({
      panCollected: true, aadhaarCollected: true, bankDetailsCollected: true,
    })).toBe(43);
  });

  it('counts agreementSignedDate only when truthy', () => {
    expect(computeOnboardingProgress({ agreementSignedDate: null, panCollected: true })).toBe(14);
    expect(computeOnboardingProgress({ agreementSignedDate: { toMillis: () => 1 } })).toBe(14);
  });
});

describe('sanitizePartnerRubric', () => {
  it('keeps prev version and coerces numbers, dropping non-numeric', () => {
    const out = sanitizePartnerRubric(
      { networkType: { 'CA / Accountant': '5', Junk: 'x' }, conflictPenalty: '-3', tierThresholds: { hot: 10 } },
      R,
    );
    expect(out.version).toBe(R.version);
    expect(out.networkType['CA / Accountant']).toBe(5);
    expect(out.networkType.Junk).toBeUndefined();
    expect(out.conflictPenalty).toBe(-3);
    expect(out.tierThresholds.hot).toBe(10);
    expect(out.tierThresholds.warm).toBe(R.tierThresholds.warm); // untouched → prev
  });

  it('falls back to prev maps when a section is missing/empty', () => {
    const out = sanitizePartnerRubric({}, R);
    expect(out.networkSize).toEqual(R.networkSize);
    expect(out.tierThresholds).toEqual(R.tierThresholds);
  });
});
