/**
 * useLeaveYearReset — hooks for the Leave Year-End Reset page.
 *
 * currentFyYear() returns the FY start year (2026 for FY 2026-27).
 *   April onwards → current calendar year
 *   Jan–March    → previous calendar year
 *
 * useLeaveYearResetStatus(year) — reads /leave_year_resets/{year}
 * useLeaveYearResetBadge()      — returns 1 if current FY reset not done (for nav badge)
 */

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { LeaveYearReset } from '../../../types';

/** Returns the FY start year (April 1 convention). April = month index 3 (0-based). */
export function currentFyYear(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export function useLeaveYearResetStatus(year: number): {
  reset:   LeaveYearReset | null;
  loading: boolean;
} {
  const [reset,   setReset]   = useState<LeaveYearReset | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!year) { setLoading(false); return; }
    return onSnapshot(
      doc(db, 'leave_year_resets', String(year)),
      (snap) => {
        setReset(snap.exists() ? (snap.data() as LeaveYearReset) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [year]);

  return { reset, loading };
}

/** Returns 1 (badge) if current FY reset is not yet done; 0 otherwise. */
export function useLeaveYearResetBadge(enabled: boolean): number {
  const year                = currentFyYear();
  const { reset, loading }  = useLeaveYearResetStatus(enabled ? year : 0);
  if (!enabled || loading)  return 0;
  return reset ? 0 : 1;
}
