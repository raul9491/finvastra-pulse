/**
 * Shared sessionStorage key guarding the one-shot hard refresh that recovers
 * from stale-deploy chunk failures ("Failed to fetch dynamically imported
 * module"). Set before the auto-reload fires; cleared whenever a lazy chunk
 * loads successfully — so each new deploy gets exactly one silent recovery
 * attempt and a genuinely-broken state can never reload-loop.
 */
export const CHUNK_RELOAD_GUARD_KEY = '__fv_chunk_reload';
