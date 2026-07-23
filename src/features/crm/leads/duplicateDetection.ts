import { auth } from '../../../lib/firebase';

export type DuplicateVerdict = {
  duplicate: boolean;
  matchType?: 'exact_phone' | 'exact_pan';
  name?: string;          // existing customer's name (for the warning)
  ownedByYou?: boolean;   // is the existing record already in the caller's list?
};

/**
 * Server-side duplicate check — works for EVERYONE (telecallers included), since a
 * client-side cross-owner query is blocked by rules for non-admins. Returns only a
 * minimal verdict (never another rep's phone/PAN), so duplicates can be caught in
 * entry forms without leaking contacts.
 *
 * A client-side `checkForDuplicates()` lived here until 2026-07-23. It was
 * superseded by this endpoint on 2026-06-30 — the client query threw
 * permission-denied for telecallers, which is exactly what made "Save Customer"
 * fail silently for them — and afterwards had **zero callers**. It was also
 * model-blind: it queried only the old-CRM `phone`/`panRaw` fields, so it could
 * never have matched a CRM 2.0 lead. Removed rather than left to rot into a trap
 * for the next reader.
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
