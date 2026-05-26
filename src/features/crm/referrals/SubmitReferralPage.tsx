import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { createReferralLead } from '../hooks/useLeads';

// ─── Form validation helpers (CLAUDE.md standard) ────────────────────────────

type FieldKey = 'displayName' | 'phone' | 'consentMethod';

const baseInp =
  'w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-white transition-colors';

function inp(fieldErrors: Record<string, string>, field?: FieldKey) {
  return `${baseInp} ${
    field && fieldErrors[field]
      ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
      : 'border-slate-200 focus:ring-[#C9A961]/40'
  }`;
}

function fLabel(
  fieldErrors: Record<string, string>,
  text: string,
  field?: FieldKey,
  required = false,
) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: field && fieldErrors[field] ? '#DC2626' : '#8B8B85' }}>
      {text}
      {required && <span className="text-red-500 ml-0.5">*</span>}
      {field && fieldErrors[field] && (
        <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">
          — {fieldErrors[field]}
        </span>
      )}
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SubmitReferralPage() {
  const navigate       = useNavigate();
  const { user, profile } = useAuth();

  const [form, setForm] = useState({
    displayName:    '',
    phone:          '',
    email:          '',
    productInterest: '',
    notes:          '',
    consentMethod:  '' as '' | 'verbal' | 'written' | 'digital' | 'offline_collection',
    consentGiven:   false,
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError]  = useState('');
  const [submitting, setSubmitting]    = useState(false);
  const [success, setSuccess]          = useState(false);

  // Clear a field error as soon as the user starts correcting it
  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    if (k in fieldErrors) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[k as string];
        return next;
      });
    }
  }

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};

    if (!form.displayName.trim() || form.displayName.trim().length < 2)
      errs.displayName = 'At least 2 characters required';
    if (!form.phone.trim() || !/^\d{10}$/.test(form.phone.trim()))
      errs.phone = '10-digit mobile number required';
    if (!form.consentMethod)
      errs.consentMethod = 'Select a consent method';
    if (!form.consentGiven)
      errs.consentGiven = 'You must confirm consent before submitting';

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setServerError('');
    setSubmitting(true);

    try {
      await createReferralLead(
        {
          displayName:     form.displayName.trim(),
          phone:           form.phone.trim(),
          ...(form.email.trim()          ? { email:           form.email.trim() }          : {}),
          ...(form.productInterest.trim() ? { productInterest: form.productInterest.trim() } : {}),
          ...(form.notes.trim()          ? { notes:           form.notes.trim() }          : {}),
          consentMethod: form.consentMethod as 'verbal' | 'written' | 'digital' | 'offline_collection',
        },
        user!.uid,
        profile?.displayName ?? 'An employee',
      );
      setSuccess(true);
    } catch (err) {
      console.error('[SubmitReferralPage] error:', err);
      setServerError('Failed to submit lead. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto pt-12 text-center space-y-5">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full"
          style={{ backgroundColor: '#D1FAE5' }}>
          <CheckCircle2 size={32} style={{ color: '#059669' }} />
        </div>
        <h2 className="text-xl font-bold" style={{ color: '#0A0A0A' }}>Lead submitted!</h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          <strong>{form.displayName}</strong> has been added to the referral queue. A tele-caller
          will pick it up shortly. You can track progress from My Referrals.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => {
              setSuccess(false);
              setForm({ displayName: '', phone: '', email: '', productInterest: '', notes: '', consentMethod: '', consentGiven: false });
            }}
            className="text-sm px-4 py-2 rounded-lg border transition-colors hover:bg-slate-50"
            style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
          >
            Submit another
          </button>
          <button
            onClick={() => navigate('/crm/referrals')}
            className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            View My Referrals
          </button>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto space-y-6">

      {/* Back */}
      <button
        onClick={() => navigate('/crm/referrals')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: '#8B8B85' }}
      >
        <ArrowLeft size={15} />
        My Referrals
      </button>

      <div>
        <h2 className="text-2xl font-bold" style={{ color: '#0A0A0A' }}>Submit a Lead</h2>
        <p className="text-sm mt-0.5" style={{ color: '#8B8B85' }}>
          Know someone who needs a loan, insurance, or investment? Fill in their details and
          our team will follow up.
        </p>
      </div>

      {/* Server error */}
      {serverError && (
        <div className="px-4 py-3 rounded-lg text-sm"
          style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
          {serverError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">

        {/* Full Name */}
        <div>
          {fLabel(fieldErrors, 'Full Name', 'displayName', true)}
          <input
            className={inp(fieldErrors, 'displayName')}
            placeholder="e.g. Ramesh Kumar"
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Phone */}
        <div>
          {fLabel(fieldErrors, 'Mobile Number', 'phone', true)}
          <input
            className={inp(fieldErrors, 'phone')}
            placeholder="10-digit mobile number"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            inputMode="numeric"
            maxLength={10}
          />
        </div>

        {/* Email */}
        <div>
          {fLabel(fieldErrors, 'Email (optional)', undefined, false)}
          <input
            className={`${baseInp} border-slate-200 focus:ring-[#C9A961]/40`}
            placeholder="customer@email.com"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>

        {/* Product Interest */}
        <div>
          {fLabel(fieldErrors, 'Product Interest (optional)', undefined, false)}
          <input
            className={`${baseInp} border-slate-200 focus:ring-[#C9A961]/40`}
            placeholder='e.g. Home Loan ₹50L, Term Insurance, SIP'
            value={form.productInterest}
            onChange={(e) => set('productInterest', e.target.value)}
            maxLength={100}
          />
          <p className="text-[11px] mt-1" style={{ color: '#8B8B85' }}>
            Stored as a tag on the lead — helps the tele-caller prioritise.
          </p>
        </div>

        {/* Notes */}
        <div>
          {fLabel(fieldErrors, 'Notes for tele-caller (optional)', undefined, false)}
          <textarea
            className={`${baseInp} border-slate-200 focus:ring-[#C9A961]/40 resize-none`}
            placeholder="Any context — urgency, existing relationship, specific requirements…"
            rows={3}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={500}
          />
        </div>

        {/* Consent Method */}
        <div>
          {fLabel(fieldErrors, 'Consent Method', 'consentMethod', true)}
          <select
            className={inp(fieldErrors, 'consentMethod')}
            value={form.consentMethod}
            onChange={(e) => set('consentMethod', e.target.value as typeof form.consentMethod)}
          >
            <option value="">Select how consent was obtained…</option>
            <option value="verbal">Verbal — customer verbally agreed</option>
            <option value="written">Written — signed consent form</option>
            <option value="digital">Digital — online form / WhatsApp opt-in</option>
            <option value="offline_collection">Offline collection — data collected at event/camp</option>
          </select>
        </div>

        {/* Consent checkbox */}
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-lg"
          style={{ backgroundColor: '#FFFBEB', border: `1px solid ${fieldErrors.consentGiven ? '#FCA5A5' : '#FDE68A'}` }}
        >
          <input
            id="consent"
            type="checkbox"
            checked={form.consentGiven}
            onChange={(e) => {
              set('consentGiven', e.target.checked);
              if (e.target.checked) {
                setFieldErrors((prev) => { const n = { ...prev }; delete n.consentGiven; return n; });
              }
            }}
            className="mt-0.5 accent-amber-600"
          />
          <label htmlFor="consent" className="text-xs leading-relaxed" style={{ color: '#92400E' }}>
            <strong>DPDP Act 2023 compliance:</strong> I confirm that the customer has given explicit
            consent for Finvastra to contact them and process their personal data for the purpose
            of financial product enquiry.
            {fieldErrors.consentGiven && (
              <span className="block mt-1 text-red-500 font-medium">
                — {fieldErrors.consentGiven}
              </span>
            )}
          </label>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !form.consentGiven}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
        >
          {submitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Submitting…
            </>
          ) : (
            'Submit Lead'
          )}
        </button>
      </div>
    </div>
  );
}
