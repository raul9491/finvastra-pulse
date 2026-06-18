// ─── UI preferences (pins + open sidebar sections) ───────────────────────────
// Backed by localStorage (key `fv-ui-prefs`) — zero rules risk, instant, matches
// the existing fv-theme / dismissed-* patterns. Abstracted so a future
// cross-device upgrade (a `uiPrefs` field on /users) is a localised change.
//
// Pins are stored as registry KEYS (stable); unknown keys are dropped at render,
// so renamed/removed routes never orphan a pin. Open sidebar sections are stored
// per module; when unset we fall back to DEFAULT_OPEN_GROUPS.

import { useSyncExternalStore } from 'react';
import type { ModuleKey } from '../../../config/navigation';

const KEY = 'fv-ui-prefs';

interface Prefs {
  pins: string[];
  openSections: Record<string, string[]>; // keyed by ModuleKey
}

export const DEFAULT_OPEN_GROUPS: Record<ModuleKey, string[]> = {
  hrms: ['General', 'My Work', 'Company', 'Growth', 'Support'],
  crm:  ['Dashboard', 'Workspace', 'Customers', 'Pipeline', 'Teams'],
  mis:  ['MIS'],
  command: ['Command'],
  lms: ['Learn'],
};

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      pins: Array.isArray(v.pins) ? v.pins : [],
      openSections: v.openSections && typeof v.openSections === 'object' ? v.openSections : {},
    };
  } catch { return { pins: [], openSections: {} }; }
}

let state: Prefs = load();
const listeners = new Set<() => void>();

function commit(next: Prefs) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full / private mode */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snapshot() { return state; }

export function useUiPrefs() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  const openGroups = (m: ModuleKey): string[] => s.openSections[m] ?? DEFAULT_OPEN_GROUPS[m] ?? [];

  return {
    pins: s.pins,
    isPinned: (k: string) => s.pins.includes(k),
    togglePin: (k: string) => commit({
      ...s,
      pins: s.pins.includes(k) ? s.pins.filter((x) => x !== k) : [...s.pins, k],
    }),
    openGroups,
    isGroupOpen: (m: ModuleKey, g: string) => openGroups(m).includes(g),
    toggleGroup: (m: ModuleKey, g: string) => {
      const cur = openGroups(m);
      const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
      commit({ ...s, openSections: { ...s.openSections, [m]: next } });
    },
  };
}
