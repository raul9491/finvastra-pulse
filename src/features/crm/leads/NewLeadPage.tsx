import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { createLead } from '../hooks/useLeads';
import { leadSchema, type LeadFormValues } from './leadSchema';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { checkForDuplicates } from './duplicateDetection';

function Field({ label, error, children, hint }: {
  label: string; error?: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs" style={{ color: '#8B8B85' }}>{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

const inputClass = "w-full px-3.5 py-3 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:border-navy transition-colors";
const selectClass = inputClass + " cursor-pointer";

export function NewLeadPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { employees } = useAllEmployees();
  const [submitError, setSubmitError] = useState('');

  const rmOptions = useMemo(
    () => employees.filter((e) => e.crmAccess === true || e.role === 'admin'),
    [employees],
  );

  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } =
    useForm<LeadFormValues>({
      resolver: zodResolver(leadSchema),
      defaultValues: {
        displayName: '', phone: '', email: '', panRaw: '',
        primaryOwnerId: profile?.userId ?? '',
        consentGiven: false, consentMethod: 'verbal',
      },
    });

  const consentGiven = watch('consentGiven');
  const watchedSource = watch('source');

  const onSubmit = async (values: LeadFormValues) => {
    if (!user) return;
    setSubmitError('');

    // Check for duplicates before creating
    const dups = await checkForDuplicates(values.phone, values.panRaw || undefined);
    if (dups.length > 0) {
      const matchDesc = dups[0].matchType === 'exact_phone'
        ? `phone number ${values.phone}`
        : `PAN ${values.panRaw}`;
      const existingName = dups[0].lead.displayName;
      const confirmed = window.confirm(
        `⚠ Duplicate detected!\n\nA customer with the same ${matchDesc} already exists: "${existingName}".\n\nOptions:\n• Click OK to create anyway (force)\n• Click Cancel to go back and find the existing record`,
      );
      if (!confirmed) return;
    }

    try {
      const newId = await createLead(values, user.uid);
      navigate(`/crm/leads/${newId}`, { state: { justCreated: true } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create customer. Please try again.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate('/crm/leads')}
        className="flex items-center gap-1.5 text-sm mb-6 transition-opacity hover:opacity-70"
        style={{ color: '#8B8B85' }}>
        <ArrowLeft size={15} /> Back to Customers
      </button>

      <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
        New Customer
      </h2>
      <p className="text-sm mb-8" style={{ color: '#8B8B85' }}>
        Person details only. Add loan, wealth, or insurance opportunities after saving.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Person details */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#0B1538' }}>Contact Details</h3>

          <Field label="Full Name *" error={errors.displayName?.message}>
            <input {...register('displayName')} placeholder="Full name as per PAN" className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone *" error={errors.phone?.message}>
              <input {...register('phone')} placeholder="9876543210" maxLength={10} className={inputClass} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <input {...register('email')} type="email" placeholder="customer@email.com" className={inputClass} />
            </Field>
          </div>

          <Field label="PAN" error={errors.panRaw?.message} hint="Stored securely. Displayed as ABCDE****F.">
            <input {...register('panRaw')} placeholder="ABCDE1234F" maxLength={10}
              className={`${inputClass} uppercase`}
              onChange={(e) => {
                e.target.value = e.target.value.toUpperCase();
                register('panRaw').onChange(e);
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Source *" error={errors.source?.message}>
              <select {...register('source')} className={selectClass}>
                <option value="">Select source…</option>
                <option value="website">Website</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="walkin">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="broker">Broker</option>
              </select>
            </Field>

            <Field label="Primary RM *" error={errors.primaryOwnerId?.message}>
              <Controller
                name="primaryOwnerId"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={rmOptions.map((rm) => ({ value: rm.userId, label: rm.displayName }))}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Select RM…"
                    label="Primary RM"
                  />
                )}
              />
            </Field>
          </div>

          {watchedSource === 'referral' && (
            <Field label="Referrer Name" error={errors.referrerName?.message}>
              <input
                {...register('referrerName')}
                type="text"
                placeholder="Name of person who referred"
                className={inputClass}
              />
            </Field>
          )}
        </div>

        {/* Consent */}
        <div className="rounded-2xl p-6 mb-6 space-y-4"
          style={{ backgroundColor: '#F2EFE7', border: '1px solid #C9A961' }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: '#9A7E3F' }} />
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9A7E3F' }}>
              Customer Consent — Required by DPDP Act 2023
            </h3>
          </div>

          <Field label="" error={errors.consentGiven?.message}>
            <Controller name="consentGiven" control={control}
              render={({ field }) => (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={field.value as boolean}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded shrink-0" />
                  <span className="text-sm leading-relaxed" style={{ color: '#2A2A2A' }}>
                    The customer has given consent to process their personal data for
                    financial services purposes in accordance with DPDP Act 2023.
                  </span>
                </label>
              )}
            />
          </Field>

          <Field label="Consent Method *" error={errors.consentMethod?.message}>
            <div className="flex gap-6">
              {(['verbal', 'written', 'digital'] as const).map((method) => (
                <label key={method} className="flex items-center gap-2 cursor-pointer text-sm capitalize"
                  style={{ color: '#2A2A2A' }}>
                  <input {...register('consentMethod')} type="radio" value={method} />
                  {method}
                </label>
              ))}
            </div>
          </Field>
        </div>

        {submitError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {submitError}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={isSubmitting || !consentGiven}
            className="px-8 py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {isSubmitting ? 'Saving…' : 'Save Customer'}
          </button>
          <button type="button" onClick={() => navigate('/crm/leads')}
            className="px-6 py-3 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#2A2A2A' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
