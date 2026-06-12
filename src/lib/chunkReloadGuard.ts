/**
 * Shared sessionStorage key guarding the one-shot hard refresh that recovers
 * from stale-deploy chunk failures ("Failed to fetch dynamically imported
 * module"). Set before the auto-reload fires.
 *
 * Re-arming: the guard must NOT be cleared the moment any chunk loads —
 * within one page load some chunks can succeed (service-worker cache) while
 * one consistently fails, and clearing on first success turned the one-shot
 * reload into an infinite reload loop. Instead, the guard re-arms only after
 * the app has been running stably for 15 seconds. Worst case is therefore one
 * auto-reload per 15s window; a persistent failure lands on the branded error
 * screen instead of looping.
 */
export const CHUNK_RELOAD_GUARD_KEY = '__fv_chunk_reload';

let rearmTimer: ReturnType<typeof setTimeout> | undefined;

/** Call on successful chunk loads — clears the guard after 15s of stable running. */
export function scheduleGuardRearm(): void {
  if (rearmTimer !== undefined) return; // already scheduled this page load
  rearmTimer = setTimeout(() => {
    sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
  }, 15_000);
}
