/**
 * Partner intake scoring + onboarding progress — pure, deterministic arithmetic.
 *
 * A partner candidate is a Connector doc (see src/types Connector). These
 * functions turn a handful of screening answers into a Hot/Warm/Cold tier using
 * an admin-editable rubric (partnerScoringConfig/default), and turn the onboarding
 * checklist into a 0–100 progress %. No AI — pure rules, per Pulse policy.
 *
 * Used by BOTH the server (server/crm2.ts recomputes on every relevant write) and
 * the client (read-only score breakdown / progress bar). No I/O, never throws.
 * The score object here omits `computedAt` — the server stamps that + rubricVersion
 * when it persists (pure code can't call serverTimestamp()).
 */

export interface PartnerRubric {
  version: number;
  networkType: Record<string, number>;
  networkSize: Record<string, number>;
  productDemandFit: Record<string, number>;
  priorTrackRecord: Record<string, number>;
  expectedMonthlyVolume: Record<string, number>;
  kycReadiness: Record<string, number>;
  conflictPenalty: number;               // applied (negative) when existingDsaCodeElsewhere
  tierThresholds: { hot: number; warm: number };
}

// The screening inputs the score reads — a subset of Connector.
export interface PartnerScoringInput {
  networkType?: string;
  networkSize?: string;
  productDemandFit?: string;
  priorTrackRecord?: string;
  expectedMonthlyVolume?: string;
  kycReadinessInput?: string;
  existingDsaCodeElsewhere?: boolean;
}

export interface PartnerScoreResult {
  networkTypeScore: number;
  networkSizeScore: number;
  productFitScore: number;
  trackRecordScore: number;
  volumeScore: number;
  kycScore: number;
  conflictPenalty: number;
  totalScore: number;
  tier: 'Hot' | 'Warm' | 'Cold';
  rubricVersion: number;
}

export interface PartnerOnboardingInput {
  panCollected?: boolean;
  aadhaarCollected?: boolean;
  bankDetailsCollected?: boolean;
  agreementSignedDate?: unknown;         // truthy when signed
  trainingCompleted?: boolean;
  pulseAccessCreated?: boolean;
  firstCaseLogged?: boolean;
}

/** The seed rubric written to partnerScoringConfig/default on first read. */
export const DEFAULT_PARTNER_RUBRIC: PartnerRubric = {
  version: 1,
  networkType: {
    'CA / Accountant': 3,
    'Property Dealer / Broker': 3,
    'Insurance Agent': 2,
    'HR / Corporate Contact': 2,
    'Society / RWA Office Bearer': 2,
    'Freelance Loan Agent': 1,
    'Other / Unclear': 0,
  },
  networkSize: {
    '>100 contacts': 3,
    '30-100 contacts': 2,
    '<30 contacts': 1,
    'Not Shared': 0,
  },
  productDemandFit: { 'Strong Fit': 3, 'Partial Fit': 2, 'Unclear': 1 },
  priorTrackRecord: { 'Proven with Examples': 3, 'Some Experience': 2, 'None': 1 },
  expectedMonthlyVolume: {
    '>5 cases/month': 3,
    '2-5 cases/month': 2,
    '<2 cases/month': 1,
    'Not Shared': 0,
  },
  kycReadiness: { 'Ready': 2, 'Partial': 1, 'Not Ready': 0 },
  conflictPenalty: -2,
  tierThresholds: { hot: 12, warm: 7 },
};

const lookup = (map: Record<string, number> | undefined, key: string | undefined): number => {
  if (!map || key === undefined) return 0;
  const v = map[key];
  return Number.isFinite(v) ? v : 0;
};

/** Compute the rubric score + tier from a candidate's screening answers. */
export function computePartnerScore(c: PartnerScoringInput, rubric: PartnerRubric): PartnerScoreResult {
  const networkTypeScore = lookup(rubric.networkType, c.networkType);
  const networkSizeScore = lookup(rubric.networkSize, c.networkSize);
  const productFitScore = lookup(rubric.productDemandFit, c.productDemandFit);
  const trackRecordScore = lookup(rubric.priorTrackRecord, c.priorTrackRecord);
  const volumeScore = lookup(rubric.expectedMonthlyVolume, c.expectedMonthlyVolume);
  const kycScore = lookup(rubric.kycReadiness, c.kycReadinessInput);
  const conflictPenalty = c.existingDsaCodeElsewhere
    ? (Number.isFinite(rubric.conflictPenalty) ? rubric.conflictPenalty : 0)
    : 0;
  const totalScore = networkTypeScore + networkSizeScore + productFitScore
    + trackRecordScore + volumeScore + kycScore + conflictPenalty;
  const tier: 'Hot' | 'Warm' | 'Cold' =
    totalScore >= rubric.tierThresholds.hot ? 'Hot'
      : totalScore >= rubric.tierThresholds.warm ? 'Warm' : 'Cold';
  return {
    networkTypeScore, networkSizeScore, productFitScore, trackRecordScore,
    volumeScore, kycScore, conflictPenalty, totalScore, tier,
    rubricVersion: rubric.version,
  };
}

/** Onboarding progress as a 0–100 integer over the 7 checklist milestones. */
export function computeOnboardingProgress(o: PartnerOnboardingInput | null | undefined): number {
  const steps = [
    !!o?.panCollected, !!o?.aadhaarCollected, !!o?.bankDetailsCollected,
    !!o?.agreementSignedDate, !!o?.trainingCompleted, !!o?.pulseAccessCreated,
    !!o?.firstCaseLogged,
  ];
  const done = steps.filter(Boolean).length;
  return Math.round((done / steps.length) * 100);
}

/** Validate + coerce an untrusted rubric payload (server-side guard on PATCH). */
export function sanitizePartnerRubric(raw: unknown, prev: PartnerRubric): PartnerRubric {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const numMap = (v: unknown, fallback: Record<string, number>): Record<string, number> => {
    if (!v || typeof v !== 'object') return { ...fallback };
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(val);
      if (Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length ? out : { ...fallback };
  };
  const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const th = (r.tierThresholds && typeof r.tierThresholds === 'object')
    ? r.tierThresholds as Record<string, unknown> : {};
  return {
    version: prev.version,   // caller bumps this
    networkType: numMap(r.networkType, prev.networkType),
    networkSize: numMap(r.networkSize, prev.networkSize),
    productDemandFit: numMap(r.productDemandFit, prev.productDemandFit),
    priorTrackRecord: numMap(r.priorTrackRecord, prev.priorTrackRecord),
    expectedMonthlyVolume: numMap(r.expectedMonthlyVolume, prev.expectedMonthlyVolume),
    kycReadiness: numMap(r.kycReadiness, prev.kycReadiness),
    conflictPenalty: num(r.conflictPenalty, prev.conflictPenalty),
    tierThresholds: {
      hot: num(th.hot, prev.tierThresholds.hot),
      warm: num(th.warm, prev.tierThresholds.warm),
    },
  };
}
