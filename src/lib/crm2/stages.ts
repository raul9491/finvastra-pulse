/**
 * Case stage machine — pure, unit-tested (spec §8.1/§8.4).
 *
 * Transition policy:
 *  - Forward by exactly ONE step along the 10-stage pipeline, OR
 *  - Jump to CLOSED from any non-terminal stage (REJECTED / WITHDRAWN outcome).
 *  - DISBURSED is NEVER reachable via the generic stage endpoint — only the
 *    Phase 4 disburse transaction may enter it (it freezes economics).
 *  - Document gating: entering LOGIN requires every mandatory LOGIN-stage
 *    tracker row VERIFIED; pddStatus → CLEARED requires no pending PDD rows.
 *    Gate failures return the pending list so the UI shows exactly what blocks.
 */

import { CASE_STAGE_ORDER, type CaseStage } from '../../types/crm2';

export interface TrackerRowLite {
  rowId: string;
  documentDefId: string;
  applicantId: string | null;
  requiredByStage: 'LOGIN' | 'SANCTION' | 'DISBURSEMENT' | 'PDD';
  status: 'PENDING' | 'REQUESTED' | 'RECEIVED' | 'VERIFIED' | 'REJECTED_REUPLOAD' | 'EXPIRED';
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
  pendingDocs?: TrackerRowLite[];   // what blocks a doc-gated transition
}

/** Validate a stage transition (order + terminal rules; doc gating is separate). */
export function validateTransition(from: CaseStage, to: CaseStage, outcome?: string | null): TransitionCheck {
  const fi = CASE_STAGE_ORDER.indexOf(from);
  const ti = CASE_STAGE_ORDER.indexOf(to);
  if (fi === -1 || ti === -1) return { ok: false, reason: `Unknown stage '${fi === -1 ? from : to}'` };
  if (from === 'CLOSED') return { ok: false, reason: 'A CLOSED case cannot change stage' };
  if (to === 'DISBURSED') {
    return { ok: false, reason: 'DISBURSED is entered only via the disburse endpoint (it freezes payout economics)' };
  }
  if (to === 'CLOSED') {
    if (from === 'PDD_OTC') return { ok: true };   // natural completion (outcome COMPLETED default)
    if (outcome !== 'REJECTED' && outcome !== 'WITHDRAWN') {
      return { ok: false, reason: 'Closing early requires outcome REJECTED or WITHDRAWN' };
    }
    return { ok: true };
  }
  if (ti !== fi + 1) {
    return { ok: false, reason: `Cannot move ${from} → ${to}; the next stage is ${CASE_STAGE_ORDER[fi + 1]}` };
  }
  return { ok: true };
}

/** Doc gate for entering a stage. Currently only LOGIN is gated (spec §8.4). */
export function gateForStage(to: CaseStage, rows: TrackerRowLite[]): TransitionCheck {
  if (to !== 'LOGIN') return { ok: true };
  const pending = rows.filter((r) => r.requiredByStage === 'LOGIN' && r.status !== 'VERIFIED');
  return pending.length === 0
    ? { ok: true }
    : { ok: false, reason: `${pending.length} mandatory LOGIN document(s) not VERIFIED`, pendingDocs: pending };
}

/** Gate for pddStatus → CLEARED: no PDD-stage rows may be unverified. */
export function gatePddClear(rows: TrackerRowLite[]): TransitionCheck {
  const pending = rows.filter((r) => r.requiredByStage === 'PDD' && r.status !== 'VERIFIED');
  return pending.length === 0
    ? { ok: true }
    : { ok: false, reason: `${pending.length} PDD document(s) still pending`, pendingDocs: pending };
}

/** % of tracker rows VERIFIED (whole-case completeness; 100 when no rows). */
export function computeDocsCompletePct(rows: TrackerRowLite[]): number {
  if (rows.length === 0) return 100;
  const verified = rows.filter((r) => r.status === 'VERIFIED').length;
  return Math.round((verified / rows.length) * 100);
}

/** True when every LOGIN-stage row is VERIFIED (stamps keyDates.docsComplete). */
export function allLoginDocsVerified(rows: TrackerRowLite[]): boolean {
  const loginRows = rows.filter((r) => r.requiredByStage === 'LOGIN');
  return loginRows.length > 0 && loginRows.every((r) => r.status === 'VERIFIED');
}

/** keyDates field stamped on entering a stage (null = none). */
export function keyDateForStage(to: CaseStage): 'login' | 'sanction' | 'closed' | null {
  switch (to) {
    case 'LOGIN': return 'login';
    case 'SANCTIONED': return 'sanction';
    case 'CLOSED': return 'closed';
    default: return null;
  }
}
