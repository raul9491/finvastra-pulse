import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTourContext } from './TourProvider';
import type { LearnModule } from '../../types';

/** Imperative tour control for the Learn pages' "Take the tour" button. */
export function useTour() {
  const { startTour, active } = useTourContext();
  return { startTour, active };
}

/**
 * Auto-start a module's first-run tour exactly once, the first time the user
 * opens that module. Gated on the cross-device `profile.onboarding[module]`
 * flag (Firestore) with a per-session guard so it never re-fires mid-session.
 * Call this once inside each module shell, e.g. useAutoStartTour('crm').
 */
export function useAutoStartTour(module: LearnModule) {
  const { profile, loading } = useAuth();
  const { startTour, hasSeenLocal } = useTourContext();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || loading || !profile) return;
    const seen = profile.onboarding?.[module] === true || hasSeenLocal(module);
    if (seen) { fired.current = true; return; }
    fired.current = true;
    // Let the shell + page paint first so the spotlight targets exist & are positioned.
    const t = setTimeout(() => startTour(module), 700);
    return () => clearTimeout(t);
  }, [loading, profile, module, startTour, hasSeenLocal]);
}
