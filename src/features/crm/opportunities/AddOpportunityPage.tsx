import { useState, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Briefcase, TrendingUp, ShieldCheck, ChevronRight, Settings } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useOpportunityTypes, createOpportunity } from '../hooks/useOpportunities';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { opportunitySchema, type OpportunityFormValues } from '../leads/opportunitySchema';
import type { OpportunityType, OpportunityTypeConfig, CustomFieldDefinition, ConditionalDocumentRule, Connector } from '../../../types';

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_META: Record<OpportunityType, { label: string; icon: React.ReactNode; desc: string; color: string }> = {
  loan:      { label: 'Loan',      icon: <Briefcase size={28} />,   desc: 'Home, Personal, Business, LAP, Auto and more', color: '#60a5fa' },
  wealth:    { label: 'Wealth',    icon: <TrendingUp size={28} />,  desc: 'Mutual Funds, PMS, AIF, Bonds, NPS and more',  color: '#34d399' },
  insurance: { label: 'Insurance', icon: <ShieldCheck size={28} />, desc: 'Term, Health, Motor, Travel and more',         color: '#fb923c' },
};

const TYPE_BG: Record<OpportunityType, string> = {
  loan: 'rgba(96,165,250,0.10)', wealth: 'rgba(52,211,153,0.10)', insurance: 'rgba(251,146,60,0.10)',
};

const inputClass  = "glass-inp w-full text-sm";
const selectClass = inputClass + " cursor-pointer";

// ─── Dynamic field renderer (loan custom fields) ─────────────────────────────
function DynamicFieldRenderer({
  schema,
  conditionalRules,
  values,
  onChange,
  errors,
}: {
  schema: Record<string, CustomFieldDefinition>;
  conditionalRules: ConditionalDocumentRule[];
  values: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
  errors: Record<string, string>;
}) {
  // conditionalRules are for document visibility — not used for field-level show/hide here.
  // We reference it to satisfy the interface contract and allow future field-conditional logic.
  void conditionalRules;

  return (
    <div className="space-y-4">
      {Object.entries(schema).map(([fieldKey, def]) => {
        const value = values[fieldKey];

        const label = (
          <label
            htmlFor={`cf-${fieldKey}`}
            className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {def.label}{def.required && ' *'}
          </label>
        );

        const error = errors[fieldKey]
          ? <p className="mt-1 text-xs text-red-400">{errors[fieldKey]}</p>
          : null;

        if (def.type === 'boolean') {
          return (
            <div key={fieldKey}>
              <label htmlFor={`cf-${fieldKey}`} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  id={`cf-${fieldKey}`}
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => onChange({ ...values, [fieldKey]: e.target.checked })}
                  className="w-4 h-4 rounded border-(--shell-border-mid) accent-navy"
                />
                <span style={{ color: 'var(--text-primary)' }}>{def.label}</span>
              </label>
              {error}
            </div>
          );
        }

        if (def.type === 'enum') {
          return (
            <div key={fieldKey}>
              {label}
              <select
                id={`cf-${fieldKey}`}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange({ ...values, [fieldKey]: e.target.value })}
                className={selectClass}
              >
                <option value="">Select…</option>
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {error}
            </div>
          );
        }

        if (def.type === 'number') {
          return (
            <div key={fieldKey}>
              {label}
              <input
                id={`cf-${fieldKey}`}
                type="number"
                min={def.min}
                max={def.max}
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => onChange({ ...values, [fieldKey]: e.target.valueAsNumber })}
                className={inputClass}
              />
              {error}
            </div>
          );
        }

        if (def.type === 'date') {
          return (
            <div key={fieldKey}>
              {label}
              <input
                id={`cf-${fieldKey}`}
                type="date"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange({ ...values, [fieldKey]: e.target.value })}
                className={inputClass}
              />
              {error}
            </div>
          );
        }

        // Default: text
        return (
          <div key={fieldKey}>
            {label}
            <input
              id={`cf-${fieldKey}`}
              type="text"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange({ ...values, [fieldKey]: e.target.value })}
              className={inputClass}
            />
            {error}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Choose type ──────────────────────────────────────────────────────
function Step1({ onSelect }: { onSelect: (t: OpportunityType) => void }) {
  return (
    <div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>What type of opportunity is this?</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.entries(TYPE_META) as [OpportunityType, typeof TYPE_META[OpportunityType]][]).map(([type, meta]) => (
          <button key={type} onClick={() => onSelect(type)}
            className="group text-left rounded-2xl p-6 transition-all hover:shadow-md hover:-translate-y-0.5"
            style={{ backgroundColor: TYPE_BG[type], border: `1px solid ${meta.color}30` }}>
            <div className="mb-4" style={{ color: meta.color }}>{meta.icon}</div>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{meta.label}</h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{meta.desc}</p>
            <div className="flex items-center gap-1 mt-4 text-xs font-semibold" style={{ color: meta.color }}>
              Select <ChevronRight size={12} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2: Choose product ───────────────────────────────────────────────────
function Step2({
  selectedType, types, loading, onSelect, onBack, isAdmin,
}: {
  selectedType: OpportunityType;
  types: OpportunityTypeConfig[];
  loading: boolean;
  onSelect: (tc: OpportunityTypeConfig) => void;
  onBack: () => void;
  isAdmin: boolean;
}) {
  const filtered = types.filter((t) => t.businessLine === selectedType);
  const meta = TYPE_META[selectedType];

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-4 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={14} /> Back
      </button>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Choose a <strong style={{ color: meta.color }}>{meta.label}</strong> product:
      </p>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel py-12 text-center space-y-3">
          <Settings size={32} className="mx-auto opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            No {meta.label} products configured yet
          </p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: 'var(--text-muted)' }}>
            {isAdmin
              ? 'Run "Seed CRM Config" from the CRM Dashboard to load all product types, providers, and document templates.'
              : 'Ask your admin to run CRM Setup from the Dashboard.'}
          </p>
          {isAdmin && (
            <Link
              to="/crm"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold mt-2"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              Go to Dashboard →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((tc) => (
            <button key={tc.id} onClick={() => onSelect(tc)}
              className="text-left px-4 py-3 rounded-xl glass-panel hover:shadow-sm transition-all text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}>
              {tc.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Fill details ─────────────────────────────────────────────────────
function Step3({
  selectedTypeConfig,
  employees,
  connectors,
  connectorId,
  onConnectorChange,
  defaultOwnerId,
  onBack,
  onSubmit,
  isSubmitting,
  submitError,
  customFields,
  onCustomFieldsChange,
}: {
  selectedTypeConfig: OpportunityTypeConfig;
  employees: { userId: string; displayName: string }[];
  connectors: Connector[];
  connectorId: string;
  onConnectorChange: (id: string) => void;
  defaultOwnerId: string;
  onBack: () => void;
  onSubmit: (v: OpportunityFormValues) => void;
  isSubmitting: boolean;
  submitError: string;
  customFields: Record<string, unknown>;
  onCustomFieldsChange: (fields: Record<string, unknown>) => void;
}) {
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const { register, handleSubmit, formState: { errors } } = useForm<OpportunityFormValues>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: { dealSize: 0, ownerId: defaultOwnerId, notes: '' },
  });

  // Validate required custom fields before delegating to the wizard's onSubmit.
  const handleFormSubmit = (values: OpportunityFormValues) => {
    const customErrors: Record<string, string> = {};
    if (selectedTypeConfig.customFieldsSchema) {
      for (const [key, def] of Object.entries(selectedTypeConfig.customFieldsSchema)) {
        if (def.required) {
          const val = customFields[key];
          if (val === undefined || val === null || val === '') {
            customErrors[key] = `${def.label} is required`;
          }
        }
      }
    }
    setCustomFieldErrors(customErrors);
    if (Object.keys(customErrors).length > 0) return;
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      <button type="button" onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-6 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="glass-panel p-6 space-y-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{ backgroundColor: TYPE_BG[selectedTypeConfig.businessLine], color: TYPE_META[selectedTypeConfig.businessLine].color }}>
            {selectedTypeConfig.businessLine}
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedTypeConfig.name}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Deal Size ₹ *
            </label>
            <input {...register('dealSize', { valueAsNumber: true })} type="number"
              placeholder="500000" min={1} className={inputClass} />
            {errors.dealSize && <p className="mt-1 text-xs text-red-400">{errors.dealSize.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Assign to RM *
            </label>
            <select {...register('ownerId')} className={selectClass}>
              <option value="">Select RM…</option>
              {employees.map((e) => <option key={e.userId} value={e.userId}>{e.displayName}</option>)}
            </select>
            {errors.ownerId && <p className="mt-1 text-xs text-red-400">{errors.ownerId.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Sourced by Connector
          </label>
          <SearchableSelect
            options={[
              { value: '', label: 'Direct / no connector' },
              ...connectors.map((c) => ({
                value: c.id,
                label: `${c.displayName} · ${c.connectorCode}`,
                description: c.firmName ?? undefined,
                searchKeywords: [c.connectorCode, c.mobile],
              })),
            ]}
            value={connectorId}
            onChange={onConnectorChange}
            placeholder="Direct / no connector"
          />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            The channel partner who brought this case (manage in HRMS → Connectors).
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Expected Close Date
          </label>
          <input {...register('expectedCloseDate')} type="date" className={inputClass} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Notes
          </label>
          <textarea {...register('notes')} rows={3} placeholder="Any context about this opportunity…"
            className={`${inputClass} resize-none`} />
        </div>

        {selectedTypeConfig.businessLine === 'loan' &&
          selectedTypeConfig.customFieldsSchema &&
          Object.keys(selectedTypeConfig.customFieldsSchema).length > 0 && (
          <div className="pt-5 space-y-4" style={{ borderTop: '1px solid var(--shell-border)' }}>
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Loan Details
            </h3>
            <DynamicFieldRenderer
              schema={selectedTypeConfig.customFieldsSchema}
              conditionalRules={selectedTypeConfig.conditionalDocuments ?? []}
              values={customFields}
              onChange={onCustomFieldsChange}
              errors={customFieldErrors}
            />
          </div>
        )}

        <div className="pt-1">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Starting stage: <strong style={{ color: 'var(--text-primary)' }}>{selectedTypeConfig.stages[0]}</strong>
          </p>
        </div>
      </div>

      {submitError && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
          {submitError}
        </div>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={isSubmitting}
          className="px-8 py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          {isSubmitting ? 'Creating…' : 'Create Opportunity'}
        </button>
      </div>
    </form>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
export function AddOpportunityPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { types, loading: typesLoading } = useOpportunityTypes();
  const { employees } = useAllEmployees();
  const { connectors } = useConnectors();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<OpportunityType | null>(null);
  const [selectedTypeConfig, setSelectedTypeConfig] = useState<OpportunityTypeConfig | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [connectorId, setConnectorId] = useState('');

  // Active connectors that cover the chosen business line — for the source picker.
  const connectorOptions = useMemo(
    () => (selectedType
      ? connectors.filter((c) => c.status === 'active' && c.verticals.includes(selectedType))
      : []),
    [connectors, selectedType],
  );

  const isAdmin = profile?.role === 'admin';

  const rmOptions = useMemo(
    () => employees.filter((e) => e.crmAccess === true || e.role === 'admin'),
    [employees],
  );

  const STEP_LABELS = ['Choose Type', 'Choose Product', 'Details'];

  const handleSubmit = async (values: OpportunityFormValues) => {
    if (!user || !leadId || !selectedType || !selectedTypeConfig) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const conn = connectorId ? connectors.find((c) => c.id === connectorId) : null;
      const newId = await createOpportunity(
        leadId,
        selectedType,
        selectedTypeConfig.name,
        selectedTypeConfig.stages[0],
        values,
        user.uid,
        customFields,
        conn ? { id: conn.id, code: conn.connectorCode, name: conn.displayName } : null,
      );
      navigate(`/crm/leads/${leadId}/opportunities/${newId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create opportunity.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(`/crm/leads/${leadId}`)}
        className="flex items-center gap-1.5 text-sm mb-6 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Customer
      </button>

      <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
        Add Opportunity
      </h2>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8 mt-3">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done   = n < step;
          const active = n === step;
          return (
            <div key={label} className="flex items-center">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: done ? '#C9A961' : active ? '#C9A961' : 'var(--shell-hover-hard)',
                    color: done ? '#0B1538' : active ? '#0B1538' : 'var(--text-dim)',
                  }}>
                  {done ? '✓' : n}
                </div>
                <span className="text-xs font-medium" style={{ color: active ? 'var(--text-primary)' : 'var(--text-dim)' }}>{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className="w-8 h-px mx-2" style={{ backgroundColor: done ? '#C9A961' : 'var(--shell-hover-hard)' }} />
              )}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <Step1 onSelect={(t) => { setSelectedType(t); setStep(2); }} />
      )}
      {step === 2 && selectedType && (
        <Step2
          selectedType={selectedType}
          types={types}
          loading={typesLoading}
          onSelect={(tc) => { setSelectedTypeConfig(tc); setStep(3); }}
          onBack={() => setStep(1)}
          isAdmin={isAdmin}
        />
      )}
      {step === 3 && selectedTypeConfig && (
        <Step3
          selectedTypeConfig={selectedTypeConfig}
          employees={rmOptions}
          connectors={connectorOptions}
          connectorId={connectorId}
          onConnectorChange={setConnectorId}
          defaultOwnerId={profile?.userId ?? ''}
          onBack={() => setStep(2)}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitError={submitError}
          customFields={customFields}
          onCustomFieldsChange={setCustomFields}
        />
      )}
    </div>
  );
}
