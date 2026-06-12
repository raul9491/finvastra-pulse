/**
 * Lead/client dedupe key normalisation — pure, unit-tested.
 *
 * dupeKeys are stored on leads + clients and queried with array-contains:
 *   mobile → "m:<10-digit>"  (strips +91 / 91 prefix, spaces, dashes)
 *   email  → "e:<lowercased trimmed>"
 * Dedupe FLAGS (duplicateOfLeadId), it never blocks creation.
 */

export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Build the dupeKeys array for a lead/client. Invalid inputs contribute nothing. */
export function buildDupeKeys(mobile: string | null | undefined, email: string | null | undefined): string[] {
  const keys: string[] = [];
  const m = normaliseMobile(mobile);
  if (m) keys.push(`m:${m}`);
  const e = normaliseEmail(email);
  if (e) keys.push(`e:${e}`);
  return keys;
}
