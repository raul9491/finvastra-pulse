import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { createLead } from '../hooks/useLeads';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import { leadSchema, type LeadFormValues } from './leadSchema';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { checkForDuplicates } from './duplicateDetection';
import { getCurrentPosition, mapsLink, type GeoPoint } from '../../../lib/geo';

function Field({ label, error, children, hint }: {
  label: string; error?: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

const inputClass = "glass-inp w-full text-sm";
const selectClass = inputClass + " cursor-pointer";

export function NewLeadPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { employees } = useAllEmployees();
  const { connectors } = useConnectors();
  const [submitError, setSubmitError] = useState('');
  const [connectorId, setConnectorId] = useState('');

  // Field ops — RM captures the meeting spot when adding a customer on the go
  const [meetingLoc, setMeetingLoc] = useState<GeoPoint | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'getting' | 'error'>('idle');
  const [locError, setLocError] = useState('');

  const handleCaptureLocation = async () => {
    setLocStatus('getting');
    setLocError('');
    try {
      setMeetingLoc(await getCurrentPosition());
      setLocStatus('idle');
    } catch (e) {
      setLocError(e instanceof Error ? e.message : 'Could not get location.');
      setLocStatus('error');
    }
  };

  const rmOptions = useMemo(
    () => employees.filter((e) => e.crmAccess === true || e.role === 'admin'),
    [employees],
  );
  const activeConnectors = useMemo(
    () => connectors.filter((c) => c.status === 'active'),
    [connectors],
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

  // The connector picker is only relevant when the source is a Connector —
  // clear any selection if the user switches to a different source.
  useEffect(() => {
    if (watchedSource !== 'sub_dsa' && connectorId) setConnectorId('');
  }, [watchedSource, connectorId]);

  const onSubmit = async (values: LeadFormValues) => {
    if (!user) return;
    setSubmitError('');

    try {
      // Check for duplicates before creating. checkForDuplicates skips itself
      // gracefully if the user can't run the cross-owner query (telecallers), so it
      // won't break the save — and it's inside this try so any error is surfaced,
      // never swallowed (that silent failure is exactly what broke "Save Customer").
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

      const conn = values.source === 'sub_dsa' && connectorId
        ? activeConnectors.find((c) => c.id === connectorId)
        : null;
      const newId = await createLead(values, user.uid,
        conn ? { id: conn.id, code: conn.connectorCode, name: conn.displayName } : null,
        meetingLoc ? { lat: meetingLoc.lat, lng: meetingLoc.lng } : null);
      navigate(`/crm/leads/${newId}`, { state: { justCreated: true } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create customer. Please try again.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate('/crm/leads')}
        className="flex items-center gap-1.5 text-sm mb-6 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Customers
      </button>

      <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
        New Customer
      </h2>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        Person details only. Add loan, wealth, or insurance opportunities after saving.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Person details */}
        <div className="glass-panel p-6 space-y-5 mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>Contact Details</h3>

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
                <option value="sub_dsa">Connector</option>
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

          {watchedSource === 'sub_dsa' && (
            <Field label="Sourced by Connector" hint="The connector who brought this customer. Manage the list in CRM → Admin → Masters → Connectors.">
              <SearchableSelect
                options={[
                  { value: '', label: 'Direct / no Connector' },
                  ...activeConnectors.map((c) => ({
                    value: c.id,
                    label: `${c.displayName} · ${c.connectorCode}`,
                    description: c.firmName ?? undefined,
                    searchKeywords: [c.connectorCode, c.mobile],
                  })),
                ]}
                value={connectorId}
                onChange={setConnectorId}
                placeholder="Select connector…"
              />
            </Field>
          )}

          {/* Field-meeting location — optional GPS tag for on-site customer additions */}
          <Field label="Meeting Location" hint={meetingLoc ? undefined : 'On a field visit? Tag where you met the customer.'}>
            <div className="flex flex-wrap items-center gap-2">
              {meetingLoc ? (
                <>
                  <a
                    href={mapsLink(meetingLoc)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium no-underline hover:underline"
                    style={{ color: '#C9A961' }}
                  >
                    📍 Location captured — view on map
                  </a>
                  <button
                    type="button"
                    onClick={() => setMeetingLoc(null)}
                    className="text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCaptureLocation}
                  disabled={locStatus === 'getting'}
                  className="text-sm px-4 py-2.5 rounded-lg border font-medium transition-colors hover:bg-(--shell-hover-soft) disabled:opacity-50"
                  style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
                >
                  {locStatus === 'getting' ? 'Getting location…' : '📍 Use my current location'}
                </button>
              )}
            </div>
            {locError && <p className="mt-1 text-xs text-red-400">{locError}</p>}
          </Field>
        </div>

        {/* Consent */}
        <div className="rounded-2xl p-6 mb-6 space-y-4"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: '#C9A961' }} />
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>
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
                  <span className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
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
                  style={{ color: 'var(--text-muted)' }}>
                  <input {...register('consentMethod')} type="radio" value={method} />
                  {method}
                </label>
              ))}
            </div>
          </Field>
        </div>

        {submitError && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
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
            className="px-6 py-3 rounded-lg text-sm font-medium border hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
