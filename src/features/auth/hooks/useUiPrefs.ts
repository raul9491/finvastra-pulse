// ─── UI preferences (pins + open sidebar sections) ───────────────────────────
// Backed by localStorage (key `fv-ui-prefs`) — zero rules risk, instant, matches
// the existing fv-theme / dismissed-* patterns. Abstracted so a future
// cross-device upgrade (a `uiPrefs` field on /users) is a localised change.
//
// Pins are stored as registry KEYS (stable); unknown keys are dropped at render,
// so renamed/removed routes never orphan a pin. Open sidebar sections are stored
// per module; when unset we fall back to DEFAULT_OPEN_GROUPS.

import { useSyncExternalStore } from 'react';
import { MODULE_GROUP_ORDER, type ModuleKey } from '../../../config/navigation';

const KEY = 'fv-ui-prefs';

interface Prefs {
  pins: string[];
  openSections: Record<string, string[]>; // keyed by ModuleKey
}

export const DEFAULT_OPEN_GROUPS: Record<ModuleKey, string[]> = {
  hrms: ['General', 'My Work', 'Company', 'Growth', 'Support'],
  crm:  ['Home', 'Work', 'Pipeline', 'Manage'],
  mis:  ['MIS'],
  command: ['Command'],
  lms: ['Learn'],
  social: ['Inbox'],
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

// ── Optional cross-device mirror (Phase 6) ──────────────────────────────────
// localStorage stays the instant, offline-safe primary; when a signed-in writer
// is registered we ALSO mirror to /users/{uid}.uiPrefs. The JSON-equality guard
// in hydrateUiPrefsFromCloud prevents a write→snapshot→hydrate loop.
let cloudWrite: ((p: Prefs) => void) | null = null;
export function registerUiPrefsCloud(write: ((p: Prefs) => void) | null) { cloudWrite = write; }

/** Adopt a remote prefs doc (another device, or this device's first cloud load). */
export function hydrateUiPrefsFromCloud(remote: Partial<Prefs> | null | undefined) {
  if (!remote) return;
  const merged: Prefs = {
    pins: Array.isArray(remote.pins) ? remote.pins : state.pins,
    openSections: remote.openSections && typeof remote.openSections === 'object' ? remote.openSections : state.openSections,
  };
  if (JSON.stringify(merged) === JSON.stringify(state)) return; // no change → no loop
  state = merged;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

function commit(next: Prefs) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full / private mode */ }
  cloudWrite?.(state);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snapshot() { return state; }

export function useUiPrefs() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  // Saved names from BEFORE a group rename (e.g. the 2026-07 CRM regroup:
  // Dashboard/Workspace/Customers/Teams → Home/Work/Manage) match nothing and
  // would render every section collapsed — treat a saved list with zero
  // current names as unset so the module falls back to its defaults.
  const openGroups = (m: ModuleKey): string[] => {
    const saved = s.openSections[m];
    const defaults = DEFAULT_OPEN_GROUPS[m] ?? [];
    if (!saved) return defaults;
    const current = new Set([...defaults, ...(MODULE_GROUP_ORDER[m] ?? [])]);
    return saved.some((g) => current.has(g)) ? saved : defaults;
  };

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
