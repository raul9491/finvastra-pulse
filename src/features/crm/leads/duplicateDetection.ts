import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Lead } from '../../../types';

export type DuplicateMatch = {
  lead: Lead;
  matchType: 'exact_phone' | 'exact_pan';
};

// Checks Firestore for an existing non-deleted lead matching the given phone or PAN.
// Phone check always runs. PAN check only runs when panRaw is provided AND no phone
// match was found (avoids surfacing the same lead twice).
export async function checkForDuplicates(
  phone: string,
  panRaw?: string,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // Exact phone match
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

  // Exact PAN match — only when no phone duplicate was found to avoid double-reporting
  if (panRaw && matches.length === 0) {
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
  }

  return matches;
}
