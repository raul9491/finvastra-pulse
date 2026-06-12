/**
 * Client-IP extraction behind Cloud Run — pure, unit-tested.
 *
 * Cloud Run's front end APPENDS the real connecting IP to X-Forwarded-For, so
 * any client-supplied values sit BEFORE it: taking the FIRST entry is spoofable
 * (a bot can send its own X-Forwarded-For to dodge per-IP rate limits). The
 * trustworthy value is the LAST entry. server.ts also sets `trust proxy = 1`
 * so Express's req.ip agrees; this helper is the defense-in-depth parse used
 * by the public-leads rate limiter.
 */
export function extractClientIp(xffHeader: string | string[] | undefined, fallback: string | undefined): string {
  const raw = Array.isArray(xffHeader) ? xffHeader.join(',') : (xffHeader ?? '');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : (fallback || 'unknown');
}
