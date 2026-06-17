/**
 * FIFO pull-queue work model — pure matching/eligibility/config helpers (unit-tested).
 *
 * Warm-inbound CRM 2.0 leads (ADS + public website) sit unassigned in shared,
 * oldest-first queues. A free telecaller pulls the front of the line; the claim
 * stamps owner + assignedAt atomically (see server/crm2.ts). This module is the pure
 * core: which queue a lead belongs to, and which queues a caller may pull from.
 *
 * Sits ON TOP of the SLA engine — captureAt/assignedAt/firstContactedAt unchanged.
 */

import { inferCategory } from './meta';

export interface QueueDef {
  id: string;
  name: string;
  /** Lead categories this queue serves; ['*'] = all (single shared FIFO). */
  productFilter: string[];
  /** Skill a telecaller must hold (in users/{uid}.queueSkills) to pull from it. */
  skill: string;
}

/** Default seed — overridable live via app_config/queues. */
export const DEFAULT_QUEUES: QueueDef[] = [
  { id: 'loans', name: 'Loans', productFilter: ['LOAN'], skill: 'LOANS' },
  { id: 'sip', name: 'SIP', productFilter: ['WEALTH'], skill: 'SIP' },
];

/** Build the queue list from an app_config/queues doc; falls back to DEFAULT_QUEUES. */
export function queueConfigFromDoc(doc: unknown): QueueDef[] {
  const raw = doc && typeof doc === 'object' && 'queues' in doc
    ? (doc as Record<string, unknown>).queues : doc;
  if (!Array.isArray(raw)) return DEFAULT_QUEUES;
  const out: QueueDef[] = [];
  for (const q of raw) {
    const o = q as Record<string, unknown>;
    if (typeof o?.id !== 'string' || typeof o?.skill !== 'string') continue;
    const productFilter = Array.isArray(o.productFilter)
      ? (o.productFilter as unknown[]).filter((x) => typeof x === 'string').map(String)
      : ['*'];
    out.push({
      id: o.id, name: typeof o.name === 'string' ? o.name : o.id,
      productFilter: productFilter.length ? productFilter : ['*'],
      skill: o.skill,
    });
  }
  return out.length ? out : DEFAULT_QUEUES;
}

export type QueueLead = Record<string, unknown>;

/** Effective category of a lead for queue routing: explicit category, else inferred
 *  from the captured product interest, else GENERAL. */
export function leadQueueCategory(lead: QueueLead): string {
  const cat = String(lead.category ?? '');
  if (cat && cat !== 'GENERAL') return cat;
  const sm = lead.sourceMeta as { productInterest?: unknown } | undefined;
  const pi = sm && typeof sm.productInterest === 'string' ? sm.productInterest : null;
  return inferCategory(pi) ?? 'GENERAL';
}

/** Does this queue serve this lead? */
export function queueMatchesLead(q: QueueDef, lead: QueueLead): boolean {
  if (q.productFilter.includes('*')) return true;
  return q.productFilter.includes(leadQueueCategory(lead));
}

/** Queues a caller with these skills may pull from. Empty/unset skills = ALL. */
export function eligibleQueues(queues: QueueDef[], skills: string[] | null | undefined): QueueDef[] {
  if (!skills || skills.length === 0) return queues;
  const held = new Set(skills.map((s) => String(s).toUpperCase()));
  return queues.filter((q) => held.has(String(q.skill).toUpperCase()));
}

/** Is a lead claimable by a caller with these skills (matches ≥1 eligible queue)? */
export function leadEligibleForSkills(queues: QueueDef[], skills: string[] | null | undefined, lead: QueueLead): boolean {
  return eligibleQueues(queues, skills).some((q) => queueMatchesLead(q, lead));
}

/** Which queue a lead belongs to (first configured match) — for /state bucketing. */
export function queueForLead(queues: QueueDef[], lead: QueueLead): QueueDef | null {
  return queues.find((q) => queueMatchesLead(q, lead)) ?? null;
}

/** Only warm-inbound CRM 2.0 leads (ADS + website) enter the pull queue. Cold bulk
 *  imports stay on the Import-Queue distribute path. */
export function isQueueableLead(lead: QueueLead): boolean {
  const src = String(lead.source ?? '').toUpperCase();
  return (src === 'ADS' || src === 'WEBSITE') && lead.receivedAt != null;
}
