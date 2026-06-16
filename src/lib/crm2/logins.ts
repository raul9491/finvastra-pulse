/**
 * Per-login stage machine + case roll-up — pure, unit-tested (Phase 4, decision J).
 *
 * A "login" = one file submitted to one bank/NBFC. From case stage 4 onward each
 * login runs its OWN progression:
 *   FILE_LOGIN → CODE_LOGIN_DONE → IN_PROCESS → SANCTIONED → DISBURSED → PDD_OTC → COMPLETED
 * with an early close (outcome REJECTED / WITHDRAWN → COMPLETED).
 *
 * Policy (mirrors the case machine):
 *  - Forward by exactly ONE step, OR jump to COMPLETED early with a REJECTED/
 *    WITHDRAWN outcome (a rejected/withdrawn file), OR natural completion from PDD_OTC.
 *  - DISBURSED is NEVER reachable via the generic login-stage endpoint — only the
 *    per-login disburse transaction (Build #2) may enter it (it freezes economics).
 *
 * The CASE itself stays case-level for stages 1–3 (OPENED · BASIC_DOCS · DOCS),
 * then shows a DERIVED roll-up across its logins (IN_PROGRESS / COMPLETED).
 */

import {
  LOGIN_STAGE_ORDER, type LoginStage,
  CASE_LEVEL_STAGE_ORDER, type CaseLevelStage,
} from '../../types/crm2';

export interface LoginTransitionCheck { ok: boolean; reason?: string; }

/** Validate a per-login stage transition (order + terminal + disburse-reserve). */
export function validateLoginTransition(from: LoginStage, to: LoginStage, outcome?: string | null): LoginTransitionCheck {
  const fi = LOGIN_STAGE_ORDER.indexOf(from);
  const ti = LOGIN_STAGE_ORDER.indexOf(to);
  if (fi === -1 || ti === -1) return { ok: false, reason: `Unknown login stage '${fi === -1 ? from : to}'` };
  if (from === 'COMPLETED') return { ok: false, reason: 'A COMPLETED login cannot change stage' };
  if (to === 'DISBURSED') {
    return { ok: false, reason: 'DISBURSED is entered only via the disburse endpoint (it freezes payout economics)' };
  }
  if (to === 'COMPLETED') {
    if (from === 'PDD_OTC') return { ok: true };   // natural completion (outcome COMPLETED default)
    if (outcome === 'REJECTED' || outcome === 'WITHDRAWN') return { ok: true };   // early close (rejected file)
    return { ok: false, reason: 'Completing a login early requires outcome REJECTED or WITHDRAWN' };
  }
  if (ti !== fi + 1) {
    return { ok: false, reason: `Cannot move ${from} → ${to}; the next login stage is ${LOGIN_STAGE_ORDER[fi + 1]}` };
  }
  return { ok: true };
}

/** keyDates field stamped on entering a login stage (null = none). */
export function keyDateForLoginStage(to: LoginStage):
  'codeLoginDone' | 'inProcess' | 'sanction' | 'disbursement' | 'completed' | null {
  switch (to) {
    case 'CODE_LOGIN_DONE': return 'codeLoginDone';
    case 'IN_PROCESS':      return 'inProcess';
    case 'SANCTIONED':      return 'sanction';
    case 'DISBURSED':       return 'disbursement';
    case 'COMPLETED':       return 'completed';
    default:                return null;
  }
}

export interface LoginLite { stage: LoginStage; outcome?: string | null; }

export interface CaseRollUp {
  total: number;
  completed: number;          // logins at COMPLETED (any outcome)
  successful: number;         // COMPLETED with outcome COMPLETED
  rejected: number;           // COMPLETED with outcome REJECTED/WITHDRAWN
  active: number;             // not yet COMPLETED
  allDone: boolean;           // total>0 && every login COMPLETED
  byStage: Record<string, number>;
  label: string;              // one-line headline for the case list
}

/** Derive the case's roll-up status from its logins (decision: derived roll-up). */
export function rollUpCaseStatus(logins: LoginLite[]): CaseRollUp {
  const total = logins.length;
  const byStage: Record<string, number> = {};
  for (const l of logins) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  const completedLogins = logins.filter((l) => l.stage === 'COMPLETED');
  const successful = completedLogins.filter((l) => !l.outcome || l.outcome === 'COMPLETED').length;
  const rejected = completedLogins.filter((l) => l.outcome === 'REJECTED' || l.outcome === 'WITHDRAWN').length;
  const completed = completedLogins.length;
  const active = total - completed;
  const allDone = total > 0 && completed === total;

  let label = 'No logins yet';
  if (total > 0) {
    if (allDone) {
      label = successful > 0 ? 'Completed' : 'Closed — unsuccessful';
    } else {
      // Headline = the most-advanced still-active login's stage.
      const furthest = logins
        .filter((l) => l.stage !== 'COMPLETED')
        .reduce((m, l) => Math.max(m, LOGIN_STAGE_ORDER.indexOf(l.stage)), -1);
      label = furthest >= 0 ? `In Progress · ${LOGIN_STAGE_ORDER[furthest]}` : 'In Progress';
    }
  }
  return { total, completed, successful, rejected, active, allDone, byStage, label };
}

/** A case may move to COMPLETED only once it has ≥1 login and ALL are COMPLETED. */
export function caseCanComplete(logins: LoginLite[]): LoginTransitionCheck {
  if (logins.length === 0) return { ok: false, reason: 'Add at least one login before completing the case' };
  const open = logins.filter((l) => l.stage !== 'COMPLETED');
  return open.length === 0
    ? { ok: true }
    : { ok: false, reason: `${open.length} login(s) are still in progress` };
}

/** Validate a CASE-level stage transition (stages 1–3 + roll-up COMPLETED/CLOSED). */
export function validateCaseLevelTransition(
  from: CaseLevelStage, to: CaseLevelStage, outcome?: string | null, logins: LoginLite[] = [],
): LoginTransitionCheck {
  const fi = CASE_LEVEL_STAGE_ORDER.indexOf(from);
  const ti = CASE_LEVEL_STAGE_ORDER.indexOf(to);
  if (from === 'CLOSED') return { ok: false, reason: 'A CLOSED case cannot change stage' };
  if (to === 'CLOSED') {
    if (outcome === 'REJECTED' || outcome === 'WITHDRAWN') return { ok: true };
    return { ok: false, reason: 'Closing a case early requires outcome REJECTED or WITHDRAWN' };
  }
  if (fi === -1 || ti === -1) return { ok: false, reason: `Unknown case stage '${fi === -1 ? from : to}'` };
  if (to === 'COMPLETED') return caseCanComplete(logins);
  if (ti !== fi + 1) {
    return { ok: false, reason: `Cannot move ${from} → ${to}; the next stage is ${CASE_LEVEL_STAGE_ORDER[fi + 1]}` };
  }
  return { ok: true };
}
