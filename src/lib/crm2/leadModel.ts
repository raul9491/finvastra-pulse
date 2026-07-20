/**
 * leadModel — THE single source of truth for reading a `/leads` document,
 * whichever model it belongs to. Two lead shapes coexist in the collection:
 *
 *   • old-model "Customer"  — owner = primaryOwnerId (uid),  status = leadStatus
 *                             (lowercase), name = displayName, phone = phone,
 *                             created = createdAt.  NO `receivedAt`.
 *   • CRM 2.0   "Lead"      — owner = assignedRm (FAPL code), status = status
 *                             (UPPERCASE), name = name, phone = mobile,
 *                             created = receivedAt.  HAS `receivedAt`.
 *
 * EVERY computation that reads /leads (performance, activity, workload,
 * not-eligible, scorecards, briefings, dashboards) MUST go through these
 * helpers so the two models can never again be counted inconsistently.
 *
 * Pure — no Firestore imports — so it runs identically on the server and client.
 *
 * ⚠️ THE TWO TRAPS these helpers exist to kill:
 *   1. Owner: old-model uses a UID, CRM 2.0 uses a FAPL code. Never compare a
 *      lead's owner to a uid without checking the model — use ownerRef().
 *   2. Deleted: CRM 2.0 leads created via the API OMIT the `deleted` field, so a
 *      Firestore `where("deleted","==",false)` query SILENTLY EXCLUDES them.
 *      Never filter deleted at the query — fetch all + isDeleted() in memory.
 */

/** A minimal structural view of a lead doc — accepts either model's fields. */
export interface LeadDocLike {
  receivedAt?: unknown;              // presence => CRM 2.0 lead
  deleted?: boolean;
  converted?: boolean;
  // old-model
  primaryOwnerId?: string | null;
  leadStatus?: string | null;
  displayName?: string | null;
  phone?: string | null;
  createdAt?: { toMillis?: () => number } | null;
  callbackAt?: string | null;
  creditScore?: number | null;
  notEligibleReason?: string | null;
  // CRM 2.0
  assignedRm?: string | null;
  status?: string | null;
  name?: string | null;
  leadCode?: string | null;
  mobile?: string | null;
  firstContactedAt?: unknown;
  [k: string]: unknown;
}

/** The ONE unified status vocabulary (the old-model buckets — CRM 2.0 maps in). */
export type LeadBucket =
  | 'new' | 'interested' | 'callback'
  | 'not_interested' | 'no_response' | 'wrong_number' | 'not_eligible' | 'converted';

export const LEAD_BUCKETS: LeadBucket[] =
  ['new', 'interested', 'callback', 'not_interested', 'no_response', 'wrong_number', 'not_eligible', 'converted'];

/** Buckets that mean the lead is CLOSED (no more work / drops out of SLA). */
export const LEAD_TERMINAL: ReadonlySet<LeadBucket> =
  new Set<LeadBucket>(['not_interested', 'no_response', 'wrong_number', 'not_eligible', 'converted']);

/** CRM 2.0 status enum → the unified bucket. */
const CRM2_TO_BUCKET: Record<string, LeadBucket> = {
  NEW: 'new', QUEUED: 'new', ASSIGNED: 'new', ATTEMPTED: 'new',
  CONTACTED: 'interested', QUALIFIED: 'interested',
  CONVERTED: 'converted', NOT_INTERESTED: 'not_interested',
  NOT_ELIGIBLE: 'not_eligible', DROPPED: 'no_response', JUNK_DUPLICATE: 'wrong_number',
};

const ms = (v: unknown): number => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t?.toMillis ? t.toMillis() : 0;
};

/** TRUE when the doc is a CRM 2.0 lead (has receivedAt), else an old-model customer. */
export const isCrm2Lead = (l: LeadDocLike): boolean => l.receivedAt != null;

/** TRUE only when explicitly soft-deleted. Never rely on a `deleted==false` query. */
export const isLeadDeleted = (l: LeadDocLike): boolean => l.deleted === true;

/** The unified status bucket for either model (converted always wins). */
export function leadBucket(l: LeadDocLike): LeadBucket {
  if (isCrm2Lead(l)) {
    if (l.converted === true || l.status === 'CONVERTED') return 'converted';
    return CRM2_TO_BUCKET[String(l.status ?? '')] ?? 'new';
  }
  const st = (typeof l.leadStatus === 'string' && l.leadStatus) ? l.leadStatus : 'new';
  return (LEAD_BUCKETS as string[]).includes(st) ? (st as LeadBucket) : 'new';
}

export const isLeadConverted = (l: LeadDocLike): boolean => leadBucket(l) === 'converted';
export const isLeadTerminal = (l: LeadDocLike): boolean => LEAD_TERMINAL.has(leadBucket(l));
/** Open = not deleted and not in a terminal (closed) state. */
export const isLeadOpen = (l: LeadDocLike): boolean => !isLeadDeleted(l) && !isLeadTerminal(l);

/** Owner reference — the model dictates whether it's a uid or a FAPL code. */
export interface LeadOwner { kind: 'uid' | 'fapl'; value: string | null }
export function leadOwner(l: LeadDocLike): LeadOwner {
  if (isCrm2Lead(l)) {
    const fapl = (typeof l.assignedRm === 'string' && l.assignedRm) ? l.assignedRm : null;
    return { kind: 'fapl', value: fapl };
  }
  const uid = (typeof l.primaryOwnerId === 'string' && l.primaryOwnerId && l.primaryOwnerId !== 'UNASSIGNED')
    ? l.primaryOwnerId : null;
  return { kind: 'uid', value: uid };
}

export const leadName = (l: LeadDocLike): string =>
  String((isCrm2Lead(l) ? (l.name ?? l.leadCode) : l.displayName) ?? 'Lead');

export const leadMobile = (l: LeadDocLike): string | null =>
  (isCrm2Lead(l) ? l.mobile : l.phone) ?? null;

/** Creation instant in ms — receivedAt for CRM 2.0, createdAt for old-model. */
export const leadCreatedMs = (l: LeadDocLike): number =>
  isCrm2Lead(l) ? ms(l.receivedAt) : ms(l.createdAt);

/** First-contact instant in ms (0 if never contacted). Both models use this field. */
export const leadFirstContactedMs = (l: LeadDocLike): number => ms(l.firstContactedAt);
export const leadAttempted = (l: LeadDocLike): boolean => l.firstContactedAt != null;

/**
 * Resolve a lead to a single "owner key" comparable against a lookup that maps
 * BOTH uids and FAPL codes to the same person. Returns null when unassigned.
 */
export function leadOwnerValue(l: LeadDocLike): string | null {
  return leadOwner(l).value;
}
