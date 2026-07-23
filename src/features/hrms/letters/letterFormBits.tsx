/**
 * Static catalogue + form-style helpers for the HR letter generator, and the
 * LetterRow used by its recent-letters list.
 *
 * Extracted verbatim from HrLetterGeneratorPage.tsx (2026-07-23) - no behaviour
 * change. NOTE the page itself stays large: it is ONE component holding ~60
 * interleaved useState values across five letter types, so the remaining bulk
 * cannot be moved mechanically - splitting it further means restructuring that
 * state, which is a redesign rather than a refactor and is not worth the
 * regression risk on legal documents without a deliberate pass.
 */
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import type { GeneratedLetter } from '../../../types';
import type { LetterType, Salutation, SalaryRow } from './letterPdf';

export const LETTER_TYPES: { value: LetterType; label: string; desc: string }[] = [
  { value: 'offer_letter',        label: 'Offer Letter',           desc: 'Pre-joining offer for new candidates'},
  { value: 'appointment',         label: 'Appointment Letter',     desc: 'Full legal employment accord'        },
  { value: 'confirmation',        label: 'Confirmation Letter',    desc: 'End of probation — permanent status' },
  { value: 'probation_extension', label: 'Probation Extension',    desc: 'Extend probation period'             },
  { value: 'consultant_agreement',label: 'Consultant Agreement',   desc: '13-clause engagement contract'       },
];

export const SALARY_COMPONENTS = [
  'Basic Salary',
  'House Rent Allowance (HRA)',
  'Conveyance Allowance',
  'Medical Allowance',
  'Special Allowance',
  'Performance Incentive',
  'Travel Allowance',
  'Other Allowance',
];

/** Convert a number to Indian number-system words. e.g. 1800000 → "Eighteen Lakh Only" */

export const SALUTATIONS: Salutation[] = ['Mr.', 'Ms.', 'Mrs.', 'Dr.'];

// Admin-only employee docs the letter form prefills from.
export type EmpDetails = { gender?: string; presentAddress?: string; permanentAddress?: string };
export type EmpSalary  = {
  salaryBasic?: number; salaryHra?: number; salaryConveyance?: number;
  salaryMedical?: number; salaryOther?: number; grossSalary?: number;
};

// ─── Default salary row components ───────────────────────────────────────────

export const DEFAULT_SALARY_ROWS: SalaryRow[] = [
  { component: 'Basic Salary',              description: 'Monthly Fixed', monthly: '' },
  { component: 'House Rent Allowance',      description: '',              monthly: '' },
  { component: 'Conveyance Allowance',      description: '',              monthly: '' },
  { component: 'Other Allowance',           description: '',              monthly: '' },
];

// ─── Form style helpers ───────────────────────────────────────────────────────

export const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors';
export const baseTa  = `${baseInp} resize-none`;

export const inp = (field?: string, fe?: Record<string, string>) =>
  `${baseInp} ${field && fe?.[field]
    ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
    : 'border-(--shell-border) focus:ring-navy/10 focus:border-navy'}`;

export const fLabel = (
  text: string,
  fe: Record<string, string>,
  field?: string,
  req = false,
) => (
  <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
    style={{ color: field && fe[field] ? '#DC2626' : 'var(--text-muted)' }}>
    {text}{req && <span className="text-red-500 ml-0.5">*</span>}
    {field && fe[field] && (
      <span className="ml-2 font-medium normal-case tracking-normal text-red-500">
        — {fe[field]}
      </span>
    )}
  </label>
);

export function LetterRow({ letter: l }: { letter: GeneratedLetter }) {
  const d         = l.generatedAt?.toDate?.();
  const typeLabel = LETTER_TYPES.find((t) => t.value === l.letterType)?.label ?? l.letterType;

  return (
    <tr className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg)/50">
      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{l.employeeName}</td>
      <td className="px-4 py-3">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
          {typeLabel}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{l.refNumber}</td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{l.generatedByName}</td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {d ? format(d, 'd MMM yyyy, h:mm a') : '—'}
      </td>
      <td className="px-4 py-3">
        {l.storageUrl ? (
          <button
            onClick={() => window.open(l.storageUrl!, '_blank')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
            style={{ color: 'var(--text-primary)' }}
            title="Open / download PDF"
          >
            <Download size={12} /> PDF
          </button>
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
    </tr>
  );
}
