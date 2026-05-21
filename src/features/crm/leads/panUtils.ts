// PAN masking — DPDP Act + IT Act §43A compliance.
// Full PAN is stored in Firestore but NEVER rendered unmasked in the UI.
// Format: ABCDE1234F → ABCDE****F  (first 5 + 4 stars + last char)
export function maskPan(pan: string | undefined): string {
  if (!pan) return '';
  if (pan.length !== 10) return '*'.repeat(pan.length);
  return pan.slice(0, 5) + '****' + pan.slice(-1);
}

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// Derive masked PAN from the already-masked string (server pre-computes panMasked).
// When neither panMasked nor panRaw is available, return the placeholder.
export function getMaskedPan(lead: { panRaw?: string; panMasked?: string }): string {
  if (lead.panMasked) return lead.panMasked;
  if (lead.panRaw) return maskPan(lead.panRaw);
  return '';
}
