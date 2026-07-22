/**
 * ClientFormModal — the §4.1 Client/Account template (add / edit).
 *
 * Exposes three pieces so the convert wizard can embed the same fields:
 *   • useClientForm(initial)   — form state + validation + payload builder
 *   • ClientFieldsGrid(...)    — the nested input grid (addresses, contact,
 *                                CIBIL, existing relationships)
 *   • ClientFormModal(...)     — standalone create/edit modal (calls the API)
 *
 * Required minimum (per the doc — "process with few details, fill rest later"):
 * entity name, constitution, primary-contact mobile. Everything else optional.
 * PAN is sent raw over HTTPS; the server stores only the encrypted value + last4.
 */
import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2 } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import type { Client } from '../../../types/crm2';

export const CONSTITUTION_OPTS = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'PROPRIETORSHIP', label: 'Proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'LLP', label: 'LLP' },
  { value: 'PVT_LTD', label: 'Pvt Ltd' },
  { value: 'HUF', label: 'HUF' },
];
const KYC_OPTS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'COMPLETE', label: 'Complete' },
];

type AddressState = { line: string; city: string; state: string; pincode: string };
const emptyAddr = (): AddressState => ({ line: '', city: '', state: '', pincode: '' });

export interface ClientFormState {
  name: string; constitution: string; industry: string;
  pan: string; gstin: string; udyam: string; cin: string;
  incorporationDate: string;
  reg: AddressState; comm: AddressState; sameAddr: boolean;
  contactName: string; mobile: string; email: string;
  cibilScore: string; cibilDate: string;
  relationships: Array<{ bank: string; facility: string; outstanding: string; emi: string }>;
  kycStatus: string;
}

function blankState(): ClientFormState {
  return {
    name: '', constitution: 'INDIVIDUAL', industry: '',
    pan: '', gstin: '', udyam: '', cin: '', incorporationDate: '',
    reg: emptyAddr(), comm: emptyAddr(), sameAddr: true,
    contactName: '', mobile: '', email: '',
    cibilScore: '', cibilDate: '',
    relationships: [], kycStatus: 'PENDING',
  };
}

const isoToDateInput = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toISOString().slice(0, 10) : '';

/** Prefill the form from an existing client doc (edit mode). */
export function stateFromClient(c: Client): ClientFormState {
  const s = blankState();
  s.name = c.name ?? '';
  s.constitution = c.constitution ?? 'INDIVIDUAL';
  s.industry = c.industry ?? '';
  s.gstin = c.gstin ?? ''; s.udyam = c.udyam ?? ''; s.cin = c.cin ?? '';
  s.incorporationDate = isoToDateInput(c.incorporationDate);
  if (c.regAddress) s.reg = { ...emptyAddr(), ...c.regAddress };
  if (c.commAddress) s.comm = { ...emptyAddr(), ...c.commAddress };
  s.sameAddr = JSON.stringify(s.reg) === JSON.stringify(s.comm);
  s.contactName = c.primaryContact?.name ?? '';
  s.mobile = c.primaryContact?.mobile ?? '';
  s.email = c.primaryContact?.email ?? '';
  s.cibilScore = c.latestCibil?.score != null ? String(c.latestCibil.score) : '';
  s.cibilDate = isoToDateInput(c.latestCibil?.pulledAt);
  s.relationships = (c.existingRelationships ?? []).map((r) => ({
    bank: r.bank ?? '', facility: r.facility ?? '',
    outstanding: r.outstanding != null ? String(r.outstanding) : '',
    emi: r.emi != null ? String(r.emi) : '',
  }));
  s.kycStatus = c.kycStatus ?? 'PENDING';
  return s;
}

/** Seed the wizard's new-client form from a lead (name/mobile/email). */
export function stateFromLead(lead: { name?: string; mobile?: string; email?: string | null }): ClientFormState {
  const s = blankState();
  s.name = lead.name ?? '';
  s.contactName = lead.name ?? '';
  s.mobile = lead.mobile ?? '';
  s.email = lead.email ?? '';
  return s;
}

const MOBILE_RE = /^[6-9]\d{9}$/;

export function useClientForm(initial?: ClientFormState) {
  const [s, setS] = useState<ClientFormState>(initial ?? blankState());
  const [errs, setErrs] = useState<Record<string, string>>({});

  const set = <K extends keyof ClientFormState>(k: K, v: ClientFormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    if (errs[k as string]) setErrs((p) => { const n = { ...p }; delete n[k as string]; return n; });
  };
  const setAddr = (which: 'reg' | 'comm', k: keyof AddressState, v: string) =>
    setS((p) => ({ ...p, [which]: { ...p[which], [k]: v } }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (s.name.trim().length < 2) e.name = 'Required';
    if (!s.constitution) e.constitution = 'Required';
    if (!MOBILE_RE.test(s.mobile.replace(/[\s-]/g, '').replace(/^\+91/, ''))) e.mobile = '10-digit mobile';
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const payload = (): Record<string, unknown> => ({
    name: s.name.trim(),
    constitution: s.constitution,
    industry: s.industry.trim() || null,
    pan: s.pan.trim() || null,
    gstin: s.gstin.trim() || null,
    udyam: s.udyam.trim() || null,
    cin: s.cin.trim() || null,
    incorporationDate: s.incorporationDate || null,
    regAddress: s.reg,
    commAddress: s.sameAddr ? s.reg : s.comm,
    primaryContact: {
      name: s.contactName.trim() || s.name.trim(),
      mobile: s.mobile.replace(/[\s-]/g, '').replace(/^\+91/, ''),
      email: s.email.trim() || null,
    },
    latestCibil: s.cibilScore ? { score: Number(s.cibilScore), pulledAt: s.cibilDate || null } : null,
    existingRelationships: s.relationships
      .filter((r) => r.bank.trim() || r.facility.trim())
      .map((r) => ({
        bank: r.bank.trim(), facility: r.facility.trim(),
        outstanding: Number(r.outstanding) || 0, emi: Number(r.emi) || 0,
      })),
    kycStatus: s.kycStatus,
  });

  return { s, set, setAddr, errs, validate, payload };
}

// ─── The nested field grid (shared by the modal + the convert wizard) ─────────
export function ClientFieldsGrid({ form }: { form: ReturnType<typeof useClientForm> }) {
  const { s, set, setAddr, errs } = form;
  const addRel = () => set('relationships', [...s.relationships, { bank: '', facility: '', outstanding: '', emi: '' }]);
  const rmRel = (i: number) => set('relationships', s.relationships.filter((_, idx) => idx !== i));
  const setRel = (i: number, k: 'bank' | 'facility' | 'outstanding' | 'emi', v: string) =>
    set('relationships', s.relationships.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const addrInputs = (which: 'reg' | 'comm') => (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2"><input className={inp()} placeholder="Address line" value={s[which].line} onChange={(e) => setAddr(which, 'line', e.target.value)} /></div>
      <input className={inp()} placeholder="City" value={s[which].city} onChange={(e) => setAddr(which, 'city', e.target.value)} />
      <input className={inp()} placeholder="State" value={s[which].state} onChange={(e) => setAddr(which, 'state', e.target.value)} />
      <input className={inp()} placeholder="Pincode" value={s[which].pincode} onChange={(e) => setAddr(which, 'pincode', e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Entity */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <FLabel text="Entity / Client Name" required error={errs.name} />
          <input className={inp(!!errs.name)} value={s.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <FLabel text="Constitution" required error={errs.constitution} />
          <SearchableSelect value={s.constitution} onChange={(v) => set('constitution', v)} options={CONSTITUTION_OPTS} />
        </div>
        <div>
          <FLabel text="Business Nature / Industry" />
          <input className={inp()} value={s.industry} onChange={(e) => set('industry', e.target.value)} />
        </div>
      </div>

      {/* Identifiers */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Identifiers</p>
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="PAN" /><input className={inp()} value={s.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} /></div>
          <div><FLabel text="GSTIN" /><input className={inp()} value={s.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></div>
          <div><FLabel text="Udyam" /><input className={inp()} value={s.udyam} onChange={(e) => set('udyam', e.target.value)} /></div>
          <div><FLabel text="CIN" /><input className={inp()} value={s.cin} onChange={(e) => set('cin', e.target.value.toUpperCase())} /></div>
          <div><FLabel text="Incorporation / DOB" /><input type="date" className={inp()} value={s.incorporationDate} onChange={(e) => set('incorporationDate', e.target.value)} /></div>
        </div>
      </div>

      {/* Primary contact */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Primary Contact</p>
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="Contact Name" /><input className={inp()} value={s.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="defaults to entity name" /></div>
          <div><FLabel text="Mobile" required error={errs.mobile} /><input className={inp(!!errs.mobile)} value={s.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="9876543210" /></div>
          <div className="col-span-2"><FLabel text="Email" /><input className={inp()} value={s.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>
      </div>

      {/* Addresses */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Registered Address</p>
        {addrInputs('reg')}
        <label className="flex items-center gap-2 mt-3 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={s.sameAddr} onChange={(e) => set('sameAddr', e.target.checked)} />
          Communication address same as registered
        </label>
        {!s.sameAddr && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Communication Address</p>
            {addrInputs('comm')}
          </div>
        )}
      </div>

      {/* CIBIL + KYC */}
      <div className="grid grid-cols-3 gap-3">
        <div><FLabel text="Latest CIBIL" /><input type="number" className={inp()} value={s.cibilScore} onChange={(e) => set('cibilScore', e.target.value)} placeholder="e.g. 760" /></div>
        <div><FLabel text="CIBIL Pulled On" /><input type="date" className={inp()} value={s.cibilDate} onChange={(e) => set('cibilDate', e.target.value)} /></div>
        <div><FLabel text="KYC Status" /><SearchableSelect value={s.kycStatus} onChange={(v) => set('kycStatus', v)} options={KYC_OPTS} /></div>
      </div>

      {/* Existing banking relationships */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Existing Banking & Loans</p>
          <button type="button" onClick={addRel} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#C9A961' }}>
            <Plus size={13} /> Add
          </button>
        </div>
        {s.relationships.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>None added.</p>
        ) : (
          <div className="space-y-2">
            {s.relationships.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input className={`${inp()} col-span-4`} placeholder="Bank" value={r.bank} onChange={(e) => setRel(i, 'bank', e.target.value)} />
                <input className={`${inp()} col-span-3`} placeholder="Facility" value={r.facility} onChange={(e) => setRel(i, 'facility', e.target.value)} />
                <input type="number" className={`${inp()} col-span-2`} placeholder="O/s" value={r.outstanding} onChange={(e) => setRel(i, 'outstanding', e.target.value)} />
                <input type="number" className={`${inp()} col-span-2`} placeholder="EMI" value={r.emi} onChange={(e) => setRel(i, 'emi', e.target.value)} />
                <button type="button" onClick={() => rmRel(i)} className="col-span-1 flex justify-center" aria-label="Remove">
                  <Trash2 size={15} style={{ color: '#f87171' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Standalone create / edit modal ───────────────────────────────────────────
export function ClientFormModal({ mode, client, canAssignRm, faplOptions, onClose, onSaved }: {
  mode: 'create' | 'edit';
  client?: Client & { id: string };
  /** Admins may set an explicit owner RM on create; otherwise it defaults to me. */
  canAssignRm: boolean;
  faplOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const form = useClientForm(mode === 'edit' && client ? stateFromClient(client) : undefined);
  const [ownerRm, setOwnerRm] = useState(mode === 'edit' ? (client?.ownerRm ?? '') : '');
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.validate()) return;
    setBusy(true); setServerError('');
    try {
      const body = form.payload();
      if (mode === 'create' && canAssignRm && ownerRm) body.ownerRm = ownerRm;
      if (mode === 'create') {
        const r = await apiCrm2<{ ok: boolean; id: string }>('POST', '/api/crm2/clients', body);
        toast.success(`Client ${r.id} created`);
        onClose(); onSaved(r.id);
      } else if (client) {
        await apiCrm2('PATCH', `/api/crm2/clients/${client.id}`, body);
        toast.success('Client updated');
        onClose(); onSaved(client.id);
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-2xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {mode === 'create' ? 'New Client' : `Edit ${client?.id}`}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}
          <ClientFieldsGrid form={form} />
          {mode === 'create' && canAssignRm && (
            <div>
              <FLabel text="Owner RM" />
              <SearchableSelect value={ownerRm} onChange={setOwnerRm}
                options={[{ value: '', label: 'Me (default)' }, ...faplOptions]} placeholder="Me (default)" />
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create Client' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Profile-completion % over the §4.1 set — shared by the list + detail header. */
export function clientCompletionPct(c: Client): number {
  const checks: boolean[] = [
    !!c.name, !!c.constitution, !!c.industry, !!c.panLast4,
    !!c.gstin, !!(c.regAddress?.line), !!(c.commAddress?.line),
    !!c.primaryContact?.mobile, !!c.primaryContact?.email,
    !!c.latestCibil, (c.existingRelationships?.length ?? 0) > 0,
    c.kycStatus === 'COMPLETE',
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
