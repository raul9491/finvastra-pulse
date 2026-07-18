/**
 * Two-stage lead-SLA evaluation — pure, unit-tested. Bridges BOTH lead models
 * (old-model "Customers" + CRM 2.0 "Leads") via a normalizer; no schema convergence.
 *
 * Stage 1 — time-to-assign: capture → a manager assigns the lead.
 * Stage 2 — time-to-first-contact: anchor → the telecaller logs a first ATTEMPT.
 *
 * Windows are working-time budgets (see businessHours.ts) and are tunable at runtime
 * via app_config/sla; SLA_DEFAULTS mirrors the locked tier table.
 */

import { elapsedWorkingMs, DEFAULT_BUSINESS_HOURS, type BusinessHoursConfig } from './businessHours';

export type SlaTier = 'WARM' | 'COLD' | 'MANUAL';

export interface SlaWindows { stage1Ms: number; stage2Ms: number; }
export type SlaConfig = Record<SlaTier, SlaWindows>;

const MIN = 60_000;
const HOUR = 3_600_000;

/** Locked defaults (working-time). Mirror app_config/sla. */
export const SLA_DEFAULTS: SlaConfig = {
  // Warm inbound (ADS / website): fast.
  WARM: { stage1Ms: 15 * MIN, stage2Ms: 30 * MIN },
  // Cold bulk (import-distributed): slow.
  COLD: { stage1Ms: 48 * HOUR, stage2Ms: 24 * HOUR },
  // Manual (self-assigned at t=0): Stage 1 satisfied at creation.
  MANUAL: { stage1Ms: 0, stage2Ms: 30 * MIN },
};

/** Build an SlaConfig from a raw app_config/sla doc, falling back to defaults. */
export function slaConfigFromDoc(doc: Record<string, unknown> | null | undefined): SlaConfig {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && isFinite(v) && v >= 0 ? v : fallback;
  const d = (doc ?? {}) as Record<string, { stage1Ms?: unknown; stage2Ms?: unknown }>;
  return {
    WARM: { stage1Ms: num(d.WARM?.stage1Ms, SLA_DEFAULTS.WARM.stage1Ms), stage2Ms: num(d.WARM?.stage2Ms, SLA_DEFAULTS.WARM.stage2Ms) },
    COLD: { stage1Ms: num(d.COLD?.stage1Ms, SLA_DEFAULTS.COLD.stage1Ms), stage2Ms: num(d.COLD?.stage2Ms, SLA_DEFAULTS.COLD.stage2Ms) },
    MANUAL: { stage1Ms: num(d.MANUAL?.stage1Ms, SLA_DEFAULTS.MANUAL.stage1Ms), stage2Ms: num(d.MANUAL?.stage2Ms, SLA_DEFAULTS.MANUAL.stage2Ms) },
  };
}

/** Accept Firestore Timestamp (Admin or client), Date, raw {_seconds}, or ms number. */
export function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  const o = v as { toMillis?: () => number; _seconds?: number; _nanoseconds?: number; seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o._seconds === 'number') return o._seconds * 1000 + (o._nanoseconds ?? 0) / 1e6;
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

const CRM2_TERMINAL = new Set(['NOT_INTERESTED', 'NOT_ELIGIBLE', 'JUNK_DUPLICATE', 'DROPPED', 'CONVERTED']);
const OLD_TERMINAL = new Set(['not_interested', 'no_response', 'wrong_number', 'not_eligible']);

export type SlaLead = Record<string, unknown>;

export interface SlaAnchors {
  model: 'CRM2' | 'OLD';
  captureMs: number | null;
  assignedMs: number | null;
  isAssigned: boolean;
  firstContactedMs: number | null;
  isTerminal: boolean;
}

/** Normalize a lead of either model into common SLA anchors. */
export function slaAnchors(lead: SlaLead): SlaAnchors {
  const isCrm2 = lead.receivedAt != null;
  const captureMs = toMs(lead.receivedAt) ?? toMs(lead.createdAt);
  const firstContactedMs = toMs(lead.firstContactedAt);

  if (isCrm2) {
    const isAssigned = lead.assignedRm != null && String(lead.assignedRm).length > 0;
    const status = String(lead.status ?? '');
    return {
      model: 'CRM2', captureMs,
      assignedMs: isAssigned ? toMs(lead.assignedAt) : null,
      isAssigned,
      firstContactedMs,
      isTerminal: CRM2_TERMINAL.has(status) || lead.converted === true,
    };
  }
  const po = lead.primaryOwnerId;
  const isAssigned = po != null && String(po).length > 0 && String(po) !== 'UNASSIGNED';
  const leadStatus = String(lead.leadStatus ?? '');
  return {
    model: 'OLD', captureMs,
    // self-assigned manual leads stamp assignedToCurrentOwnerAt at create ≈ capture
    assignedMs: isAssigned ? (toMs(lead.assignedToCurrentOwnerAt) ?? captureMs) : null,
    isAssigned,
    firstContactedMs,
    isTerminal: OLD_TERMINAL.has(leadStatus) || lead.deleted === true,
  };
}

/** Classify a lead's SLA tier from its source / import markers (both schemas). */
export function classifySlaTier(lead: SlaLead): SlaTier {
  const src = String(lead.source ?? '').toUpperCase();
  if (lead.importBatchId != null || lead.distributedAt != null || src === 'OFFLINE_BULK' || src === 'BULK') {
    return 'COLD';
  }
  if (src === 'ADS' || src === 'SOCIAL_META' || src === 'WEBSITE') return 'WARM';
  return 'MANUAL';
}

export interface StageEval { applicable: boolean; windowMs: number; elapsedMs: number; breached: boolean; }
export interface SlaEvaluation {
  tier: SlaTier;
  model: 'CRM2' | 'OLD';
  captureMs: number | null;
  isAssigned: boolean;
  lateAssignment: boolean;   // for Stage-2 attribution (queue/manager vs telecaller)
  stage1: StageEval;
  stage2: StageEval;
}

/**
 * Evaluate both SLA stages for a lead at instant `nowMs`. Pure — pass config +
 * business-hours config explicitly (the sweep loads them from app_config).
 */
export function evaluateSla(
  lead: SlaLead,
  nowMs: number,
  cfg: SlaConfig = SLA_DEFAULTS,
  bh: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
): SlaEvaluation {
  const tier = classifySlaTier(lead);
  const a = slaAnchors(lead);
  const w = cfg[tier];

  // Stage 1 — only while unassigned (MANUAL is assigned at t=0 → never applicable).
  const stage1Applicable = !a.isTerminal && !a.isAssigned && a.captureMs != null && tier !== 'MANUAL';
  const stage1Elapsed = a.captureMs != null ? elapsedWorkingMs(a.captureMs, nowMs, bh) : 0;
  const stage1Breached = stage1Applicable && stage1Elapsed > w.stage1Ms;

  // Stage 2 — until first contact. Anchor: capture (WARM/MANUAL) or assignment (COLD).
  const stage2AnchorMs = tier === 'COLD' ? a.assignedMs : a.captureMs;
  const stage2Applicable = !a.isTerminal && a.firstContactedMs == null
    && stage2AnchorMs != null && (tier !== 'COLD' || a.isAssigned);
  const stage2Elapsed = stage2Applicable ? elapsedWorkingMs(stage2AnchorMs as number, nowMs, bh) : 0;
  const stage2Breached = stage2Applicable && stage2Elapsed > w.stage2Ms;

  // Attribution: was assignment late (or never happened)?
  let lateAssignment = false;
  if (a.captureMs != null) {
    if (!a.isAssigned) lateAssignment = true;
    else if (a.assignedMs != null) lateAssignment = elapsedWorkingMs(a.captureMs, a.assignedMs, bh) > w.stage1Ms;
  }

  return {
    tier, model: a.model, captureMs: a.captureMs, isAssigned: a.isAssigned, lateAssignment,
    stage1: { applicable: stage1Applicable, windowMs: w.stage1Ms, elapsedMs: stage1Elapsed, breached: stage1Breached },
    stage2: { applicable: stage2Applicable, windowMs: w.stage2Ms, elapsedMs: stage2Elapsed, breached: stage2Breached },
  };
}
