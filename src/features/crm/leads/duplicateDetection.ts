import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '../../../lib/firebase';
import type { Lead } from '../../../types';

export type DuplicateMatch = {
  lead: Lead;
  matchType: 'exact_phone' | 'exact_pan';
};

export type DuplicateVerdict = {
  duplicate: boolean;
  matchType?: 'exact_phone' | 'exact_pan';
  name?: string;          // existing customer's name (for the warning)
  ownedByYou?: boolean;   // is the existing record already in the caller's list?
};

/**
 * Server-side duplicate check — works for EVERYONE (telecallers included), since the
 * client-side query is blocked by rules for non-admins. Returns only a minimal verdict
 * (no other rep's phone/PAN). Use this in entry forms so duplicates are always caught.
 */
export async function checkDuplicateServer(phone: string, panRaw?: string): Promise<DuplicateVerdict> {
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/leads/check-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone, panRaw: panRaw ?? '' }),
    });
    if (!res.ok) return { duplicate: false };
    return await res.json();
  } catch {
    return { duplicate: false };   // never block the save on a check failure
  }
}

// Checks Firestore for an existing non-deleted lead matching the given phone or PAN.
// Phone check always runs. PAN check only runs when panRaw is provided AND no phone
// match was found (avoids surfacing the same lead twice).
export async function checkForDuplicates(
  phone: string,
  panRaw?: string,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // Exact phone match.
  // NOTE: a telecaller can only LIST leads they own (firestore.rules), so this
  // cross-owner query is denied for them and throws `permission-denied`. The dup
  // check is a convenience, NOT a security gate — so on ANY query error we skip it
  // gracefully and report "no duplicate" rather than break the whole Save flow.
  // (Import + server-side dedup still protect against real duplicates.)
  try {
    const phoneSnap = await getDocs(
      query(
        collection(db, 'leads'),
        where('phone', '==', phone),
        where('deleted', '==', false),
        limit(3),
      ),
    );
    for (const d of phoneSnap.docs) {
      matches.push({
        lead: { id: d.id, ...d.data() } as Lead,
        matchType: 'exact_phone',
      });
    }
  } catch (e) {
    console.warn('[duplicate check] phone query skipped (likely a non-admin without list access):', e);
    return matches;   // can't check → don't block the save
  }

  // Exact PAN match — only when no phone duplicate was found to avoid double-reporting
  if (panRaw && matches.length === 0) {
    try {
      const panSnap = await getDocs(
        query(
          collection(db, 'leads'),
          where('panRaw', '==', panRaw),
          where('deleted', '==', false),
          limit(3),
        ),
      );
      for (const d of panSnap.docs) {
        matches.push({
          lead: { id: d.id, ...d.data() } as Lead,
          matchType: 'exact_pan',
        });
      }
    } catch (e) {
      console.warn('[duplicate check] PAN query skipped:', e);
    }
  }

  return matches;
}
