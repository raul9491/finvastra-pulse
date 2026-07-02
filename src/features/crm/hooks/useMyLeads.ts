import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  limit,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Lead, Opportunity, ActivityType } from '../../../types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LeadWithOpportunity {
  lead: Lead;
  /** The most-recently-created open loan opportunity, or null if none exists. */
  firstOpenOpportunity: Opportunity | null;
}

export interface UseMyLeadsResult {
  leads: LeadWithOpportunity[];
  /** Number of leads whose slaDeadline has already passed. */
  overdue: number;
  /** Number of leads whose slaDeadline falls within the next 2 hours. */
  urgent: number;
  total: number;
  loading: boolean;
  error: string | null;
}

// ─── Urgency sorting ──────────────────────────────────────────────────────────

/** Returns deadline as epoch ms, or Infinity when no deadline is set. */
function getDeadlineMs(lead: Lead): number {
  if (!lead.slaDeadline) return Infinity;
  // Firestore Timestamp objects expose .toDate()
  if (typeof lead.slaDeadline.toDate === 'function') {
    return (lead.slaDeadline.toDate() as Date).getTime();
  }
  return Infinity;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortByUrgency(items: LeadWithOpportunity[]): LeadWithOpportunity[] {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;

  const overdue:  LeadWithOpportunity[] = [];
  const urgent:   LeadWithOpportunity[] = [];
  // social_meta and website leads need fast first-contact — keep them near the top
  const highFreq: LeadWithOpportunity[] = [];
  const rest:     LeadWithOpportunity[] = [];

  for (const item of items) {
    const dl = getDeadlineMs(item.lead);
    if (dl < now) {
      overdue.push(item);
    } else if (dl - now <= twoHoursMs) {
      urgent.push(item);
    } else if (item.lead.source === 'social_meta' || item.lead.source === 'website') {
      highFreq.push(item);
    } else {
      rest.push(item);
    }
  }

  const byDeadline = (a: LeadWithOpportunity, b: LeadWithOpportunity) =>
    getDeadlineMs(a.lead) - getDeadlineMs(b.lead);

  const byPriorityThenDate = (a: LeadWithOpportunity, b: LeadWithOpportunity) => {
    const pa = PRIORITY_ORDER[a.lead.triagePriority ?? 'low'] ?? 2;
    const pb = PRIORITY_ORDER[b.lead.triagePriority ?? 'low'] ?? 2;
    if (pa !== pb) return pa - pb;
    // Earlier leads surface first when priority ties
    const ca = a.lead.createdAt?.toDate?.()?.getTime() ?? 0;
    const cb = b.lead.createdAt?.toDate?.()?.getTime() ?? 0;
    return ca - cb;
  };

  return [
    ...overdue.sort(byDeadline),
    ...urgent.sort(byDeadline),
    ...highFreq.sort(byDeadline),
    ...rest.sort(byPriorityThenDate),
  ];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Real-time subscription to all active leads assigned to `userId` as
 * primaryOwner.  For each lead it fetches the most-recent open loan
 * opportunity — fetched once per lead and cached; on subsequent snapshots
 * only added/modified leads refetch their subcollection (avoids the N+1
 * "refetch every lead's opportunities on any single lead change" pattern).
 *
 * The returned `leads` array is sorted by urgency:
 *   1. Overdue SLA (earliest deadline first)
 *   2. SLA due within 2 hours (earliest deadline first)
 *   3. High-frequency sources (social_meta / website) — sorted by deadline
 *   4. Everything else — sorted by triagePriority then createdAt
 */
export function useMyLeads(userId: string): UseMyLeadsResult {
  const [leads, setLeads]     = useState<LeadWithOpportunity[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [urgent, setUrgent]   = useState(0);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLeads([]);
      setOverdue(0);
      setUrgent(0);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const leadsQuery = query(
      collection(db, 'leads'),
      where('primaryOwnerId', '==', userId),
      where('deleted', '==', false),
      orderBy('createdAt', 'desc'),
    );

    // Per-lead cache of the resolved first open opportunity. Persists across
    // snapshots for the lifetime of this subscription, so unchanged leads
    // never refetch their opportunities subcollection.
    const oppCache = new Map<string, Opportunity | null>();
    // Guards against out-of-order async snapshot processing: only the latest
    // snapshot's results are applied to state.
    let latestVersion = 0;
    let disposed = false;

    const unsubscribe = onSnapshot(
      leadsQuery,
      async (snapshot) => {
        const version = ++latestVersion;
        try {
          // Determine which leads actually need an opportunity (re)fetch.
          // First snapshot reports every doc as 'added'; later snapshots only
          // the deltas — the same trigger points the old code had for a
          // changed lead, minus the redundant refetch of every OTHER lead.
          const toFetch: string[] = [];
          for (const change of snapshot.docChanges()) {
            if (change.type === 'removed') {
              oppCache.delete(change.doc.id);
            } else {
              // 'added' | 'modified' — refresh this lead's open opportunity
              toFetch.push(change.doc.id);
            }
          }

          await Promise.all(
            toFetch.map(async (leadId) => {
              const oppsSnap = await getDocs(
                query(
                  collection(db, 'leads', leadId, 'opportunities'),
                  where('status', '==', 'open'),
                  orderBy('createdAt', 'desc'),
                  limit(1),
                ),
              );
              oppCache.set(
                leadId,
                oppsSnap.empty
                  ? null
                  : ({ id: oppsSnap.docs[0].id, ...oppsSnap.docs[0].data() } as Opportunity),
              );
            }),
          );

          // A newer snapshot arrived while we were fetching — let it win.
          if (disposed || version !== latestVersion) return;

          const leadsWithOpps: LeadWithOpportunity[] = snapshot.docs.map((d) => {
            const lead = { id: d.id, ...d.data() } as Lead;
            return { lead, firstOpenOpportunity: oppCache.get(lead.id) ?? null };
          });

          // Compute counts from unsorted raw data so numbers are stable
          // regardless of how the sorted array ends up ordered.
          const now = Date.now();
          const twoHoursMs = 2 * 60 * 60 * 1000;
          let overdueCount = 0;
          let urgentCount  = 0;
          for (const { lead } of leadsWithOpps) {
            const dl = getDeadlineMs(lead);
            if (dl < now) {
              overdueCount++;
            } else if (dl - now <= twoHoursMs) {
              urgentCount++;
            }
          }

          setLeads(sortByUrgency(leadsWithOpps));
          setOverdue(overdueCount);
          setUrgent(urgentCount);
          setTotal(leadsWithOpps.length);
          setLoading(false);
        } catch (err) {
          if (disposed || version !== latestVersion) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [userId]);

  // All hooks declared above — safe to short-circuit for empty userId.
  if (!userId) return { leads: [], overdue: 0, urgent: 0, total: 0, loading: false, error: null };

  return { leads, overdue, urgent, total, loading, error };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Logs a call outcome as an activity on the given opportunity.
 *
 * NOTE: If `outcome === 'Called - Not interested'`, the calling UI component
 * should prompt the user to optionally mark the opportunity as lost.
 * This function only logs the call — it does NOT auto-trigger that transition.
 */
export async function logCallOutcome(
  leadId: string,
  oppId: string,
  outcome: string,
  notes: string,
  userId: string,
): Promise<void> {
  const content = notes.trim() ? `${outcome} — ${notes.trim()}` : outcome;
  await addDoc(
    collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'),
    {
      type: 'call' as ActivityType,
      content,
      by: userId,
      at: serverTimestamp(),
    },
  );
}
