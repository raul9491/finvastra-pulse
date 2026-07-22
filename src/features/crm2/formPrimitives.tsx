/**
 * Shared CRM 2.0 form primitives — the field-label + input-class pair every
 * crm2 form uses (leads, cases, clients, masters, mappings, recon, payouts).
 *
 * These lived in `masters/MastersPage.tsx` and were imported from there by 9
 * files across the feature, which made an 1805-line page a dependency of every
 * other crm2 screen. They are pure presentation with no page context, so they
 * belong in a module of their own. Verbatim move — all 9 importers (including
 * MastersPage itself) now import from here; MastersPage exports them no longer.
 *
 * `inp(bad?)` implements the field-level inline-error standard in CLAUDE.md:
 * pass the field's error state and the input turns red in step with FLabel.
 */

/** Input class for a form field. Pass `true` when the field has a validation error. */
export const inp = (bad?: boolean) =>
  `glass-inp w-full text-sm ${bad ? 'border-red-400! focus:ring-red-200/50!' : ''}`;

/** Field label. Shows a red `*` when required and an inline red message on error. */
export function FLabel({ text, required, error }: { text: string; required?: boolean; error?: string }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: error ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {error && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {error}</span>}
    </label>
  );
}
