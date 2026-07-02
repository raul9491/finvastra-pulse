/**
 * userFacingError — turn an unknown caught error into a message that is safe
 * to show in a banner or toast.
 *
 * Deliberate application errors (a plain `throw new Error('…')` carrying a
 * human-readable message, e.g. friendly messages our API endpoints return)
 * pass through unchanged. Raw SDK / network errors (FirebaseError, fetch
 * failures, Firestore internal dumps) are replaced with a clean human
 * message — the full detail is always kept in `console.error` for diagnosis.
 */
export function userFacingError(err: unknown, fallback: string): string {
  console.error('[action failed]', err);

  const anyErr = err as { code?: unknown; name?: unknown } | null | undefined;
  const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
  const name = typeof anyErr?.name === 'string' ? anyErr.name : '';
  const msg = err instanceof Error ? err.message : '';

  // Firebase / Firestore SDK errors — never surface these raw.
  if (name === 'FirebaseError' || code) {
    if (code.includes('permission-denied') || /insufficient permissions/i.test(msg)) {
      return "You don't have permission to do this.";
    }
    if (code.includes('unavailable') || code.includes('network')) {
      return 'Network issue — check your connection and try again.';
    }
    return fallback;
  }

  // Browser fetch/network failures.
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Network issue — check your connection and try again.';
  }

  // Internal SDK dumps that occasionally escape as plain Errors.
  if (/FIRESTORE|INTERNAL ASSERTION/i.test(msg)) return fallback;

  // A plain Error with a human message (our own thrown errors / API messages).
  return msg || fallback;
}
