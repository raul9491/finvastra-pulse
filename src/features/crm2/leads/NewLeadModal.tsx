/**
 * The Add-Lead dialog.
 * 
 * The product picker is filtered by the selected lead CATEGORY (uncategorised
 * products show for all - legacy-safe), and source-specific referral pickers
 * populate referredBy* / the FAC- channel partner.
 * 
 * Extracted verbatim from Crm2LeadsPage.tsx (2026-07-23).
 */
import {
  type Opt, type ProductOpt, type RefData,
  CATEGORY_OPTS, SOURCE_OPTS, CONSTITUTION_LEAD_OPTS,
  buildReferral, buildChannelPartner, filterProductsByCat,
} from './leadOptions';
import { useState } from 'react';
import { X } from 'lucide-react';
import { apiCrm2 } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';

// ─── New lead ─────────────────────────────────────────────────────────────────
export function NewLeadModal({ faplOptions, productOptions, clientOptions, subDsaOptions, partnerOptions, refData, onClose }: {
  faplOptions: Opt[]; productOptions: ProductOpt[]; clientOptions: Opt[]; subDsaOptions: Opt[]; partnerOptions: Opt[];
  refData: RefData; onClose: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: '', customerName: '', mobile: '', email: '', city: '', category: 'LOAN', source: 'WALKIN',
    productId: '', amountRequired: '', assignedRm: '',
    linkedExistingClientId: '', refSubDsaId: '', refClientId: '', channelPartnerId: '',
    cpConstitution: '', cpBusinessName: '', cpTurnover: '', cpRequirements: '',
  });
  const [sameAsEntity, setSameAsEntity] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errs[k]) setErrs((p) => { const n = { ...p }; delete n[k]; return n; });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Required';
    if (!/^[6-9]\d{9}$/.test(f.mobile.replace(/[\s-]/g, '').replace(/^\+91/, ''))) e.mobile = '10-digit mobile';
    if (Object.keys(e).length > 0) { setErrs(e); return; }
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; id: string; duplicateOf: { id: string } | null }>('POST', '/api/crm2/leads', {
        name: f.name, customerName: (sameAsEntity ? f.name : f.customerName.trim()) || f.name,
        mobile: f.mobile, email: f.email || null, city: f.city || null,
        category: f.category, source: f.source, productId: f.productId || null,
        amountRequired: f.amountRequired ? Number(f.amountRequired) : null,
        assignedRm: f.assignedRm || null,
        linkedExistingClientId: f.linkedExistingClientId || null,
        ...buildReferral(f.source, f.refSubDsaId, f.refClientId, refData),
        ...buildChannelPartner(f.channelPartnerId, refData.connectors),
        customerProfile: {
          constitution: f.cpConstitution || null, businessName: f.cpBusinessName || null,
          annualTurnover: f.cpTurnover ? Number(f.cpTurnover) : null, requirements: f.cpRequirements || null,
        },
      });
      toast.success(`Lead ${r.id} created${r.duplicateOf ? ' — flagged as possible duplicate' : ''}`);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>New Lead</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FLabel text="Entity Name" required error={errs.name} />
              <input className={inp(!!errs.name)} value={f.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Business / applicant entity" />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Entity = the business / applicant. Customer = the person we actually call.</p>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={sameAsEntity} onChange={(e) => setSameAsEntity(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Customer name same as entity name
                </span>
              </label>
              {!sameAsEntity && (
                <input className={inp()} value={f.customerName} onChange={(e) => set('customerName', e.target.value)}
                  placeholder="Contact person's name" />
              )}
            </div>
            <div>
              <FLabel text="Mobile" required error={errs.mobile} />
              <input className={inp(!!errs.mobile)} value={f.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="9876543210" />
            </div>
            <div>
              <FLabel text="Email" />
              <input className={inp()} value={f.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <FLabel text="Category" required />
              <SearchableSelect value={f.category} onChange={(v) => { set('category', v); set('productId', ''); }} options={CATEGORY_OPTS} />
            </div>
            <div>
              <FLabel text="Source" required />
              <SearchableSelect value={f.source} onChange={(v) => set('source', v)} options={SOURCE_OPTS} />
            </div>
            {/* Source-specific referral picker */}
            {f.source === 'REFERRAL_SUBDSA' && (
              <div className="col-span-2">
                <FLabel text="Referred by (Sub DSA)" />
                <SearchableSelect value={f.refSubDsaId} onChange={(v) => set('refSubDsaId', v)}
                  options={[{ value: '', label: '— select —' }, ...subDsaOptions]} placeholder="— select —" />
              </div>
            )}
            {f.source === 'REFERRAL_CLIENT' && (
              <div className="col-span-2">
                <FLabel text="Referred by (Client)" />
                <SearchableSelect value={f.refClientId} onChange={(v) => set('refClientId', v)}
                  options={[{ value: '', label: '— select —' }, ...clientOptions]} placeholder="— select —" />
              </div>
            )}
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Optional details</span>
              <span className="flex-1 h-px" style={{ backgroundColor: 'var(--shell-border)' }} />
            </div>
            <div>
              <FLabel text="Product" />
              <SearchableSelect value={f.productId} onChange={(v) => set('productId', v)}
                options={[{ value: '', label: '—' }, ...filterProductsByCat(productOptions, f.category)]} placeholder="—" />
            </div>
            <div>
              <FLabel text="Amount Required ₹" />
              <input type="number" className={inp()} value={f.amountRequired} onChange={(e) => set('amountRequired', e.target.value)} />
            </div>
            <div className="col-span-2">
              <FLabel text="Assign RM" />
              <SearchableSelect value={f.assignedRm} onChange={(v) => set('assignedRm', v)}
                options={[{ value: '', label: 'Unassigned' }, ...faplOptions]} placeholder="Unassigned" />
            </div>
            <div className="col-span-2">
              <FLabel text="Sourced by Connector" />
              <SearchableSelect value={f.channelPartnerId} onChange={(v) => set('channelPartnerId', v)}
                options={[{ value: '', label: '— none (self-sourced) —' }, ...partnerOptions]} placeholder="— none —" />
            </div>
            <div className="col-span-2">
              <FLabel text="Link existing client (optional)" />
              <SearchableSelect value={f.linkedExistingClientId} onChange={(v) => set('linkedExistingClientId', v)}
                options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
            </div>
          </div>

          {/* Optional bigger client details */}
          <button type="button" onClick={() => setShowMore((v) => !v)}
            className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
            {showMore ? '− Hide' : '+ More'} customer details
          </button>
          {showMore && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Constitution" />
                <SearchableSelect value={f.cpConstitution} onChange={(v) => set('cpConstitution', v)} options={CONSTITUTION_LEAD_OPTS} />
              </div>
              <div>
                <FLabel text="Business name" />
                <input className={inp()} value={f.cpBusinessName} onChange={(e) => set('cpBusinessName', e.target.value)} />
              </div>
              <div>
                <FLabel text="Annual turnover ₹" />
                <input type="number" className={inp()} value={f.cpTurnover} onChange={(e) => set('cpTurnover', e.target.value)} />
              </div>
              <div className="col-span-2">
                <FLabel text="Requirements" />
                <input className={inp()} value={f.cpRequirements} onChange={(e) => set('cpRequirements', e.target.value)} placeholder="e.g. ₹50L LAP, 10yr tenure" />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Creating…' : 'Create Lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
