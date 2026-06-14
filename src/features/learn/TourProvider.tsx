import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import type { LearnModule } from '../../types';
import { TOURS, type TourStep } from './tourSteps';
import { TourOverlay } from './TourOverlay';

// How a step should render right now, based on whether its target is in the DOM:
//  - no target            → centered card (welcome / closing)
//  - target not in DOM     → SKIP (a tool this user has no access to — shells omit it)
//  - target in DOM, hidden → centered card (e.g. desktop sidebar on a phone)
//  - target in DOM, shown  → spotlight
export type StepMode = 'card' | 'skip' | 'spotlight';

export function stepMode(step: TourStep): StepMode {
  if (!step.target) return 'card';
  const el = document.querySelector(step.target) as HTMLElement | null;
  if (!el) return 'skip';
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? 'spotlight' : 'card';
}

/** First index from `start` (inclusive) in direction `dir` that is not skipped. -1 if none. */
function showableFrom(steps: TourStep[], start: number, dir: 1 | -1): number {
  for (let i = start; i >= 0 && i < steps.length; i += dir) {
    if (stepMode(steps[i]) !== 'skip') return i;
  }
  return -1;
}

interface TourState { module: LearnModule; index: number; }

interface TourContextValue {
  active: TourState | null;
  startTour: (module: LearnModule) => void;
  next: () => void;
  back: () => void;
  end: () => void;          // skip / finish — marks the module seen
  hasSeenLocal: (module: LearnModule) => boolean;
}

const TourContext = createContext<TourContextValue>({
  active: null, startTour: () => {}, next: () => {}, back: () => {}, end: () => {}, hasSeenLocal: () => false,
});

const lsKey = (module: LearnModule, uid: string) => `fv_tour_${module}_${uid}`;

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [active, setActive] = useState<TourState | null>(null);

  const hasSeenLocal = useCallback((module: LearnModule) => {
    try { return user ? localStorage.getItem(lsKey(module, user.uid)) === '1' : false; } catch { return false; }
  }, [user]);

  const markSeen = useCallback((module: LearnModule) => {
    if (!user) return;
    try { localStorage.setItem(lsKey(module, user.uid), '1'); } catch { /* storage off */ }
    // Cross-device persistence (fire-and-forget; the live profile listener reflects it).
    updateDoc(doc(db, 'users', user.uid), {
      onboarding: { ...(profile?.onboarding ?? {}), [module]: true },
    }).catch(() => {});
  }, [user, profile?.onboarding]);

  const startTour = useCallback((module: LearnModule) => {
    const steps = TOURS[module];
    const first = showableFrom(steps, 0, 1);
    if (first === -1) { markSeen(module); return; }
    setActive({ module, index: first });
  }, [markSeen]);

  const next = useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      const steps = TOURS[cur.module];
      const n = showableFrom(steps, cur.index + 1, 1);
      if (n === -1) { markSeen(cur.module); return null; }
      return { ...cur, index: n };
    });
  }, [markSeen]);

  const back = useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      const p = showableFrom(TOURS[cur.module], cur.index - 1, -1);
      return p === -1 ? cur : { ...cur, index: p };
    });
  }, []);

  const end = useCallback(() => {
    setActive((cur) => { if (cur) markSeen(cur.module); return null; });
  }, [markSeen]);

  return (
    <TourContext.Provider value={{ active, startTour, next, back, end, hasSeenLocal }}>
      {children}
      {active && (
        <TourOverlay
          step={TOURS[active.module][active.index]}
          stepNumber={active.index}
          total={TOURS[active.module].length}
          onNext={next}
          onBack={back}
          onEnd={end}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTourContext(): TourContextValue {
  return useContext(TourContext);
}
