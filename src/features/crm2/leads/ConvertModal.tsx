/**
 * The convert wizard: resolve or create the Client master record, then open the
 * case. PARTNER_DSA leads take the Sub-DSA path instead.
 * 
 * Extracted verbatim from Crm2LeadsPage.tsx (2026-07-23).
 */
import type { Client } from '../../../types/crm2';
import { type ProductOpt, type LeadRow, filterProductsByCat } from './leadOptions';
import { useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useClientForm, ClientFieldsGrid, stateFromLead } from '../clients/ClientFormModal';
import { useState } from 'react';
import { apiCrm2 } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';

// ─── Convert wizard (resolve client → case) ─────────────────────────────────
export function ConvertModal({ lead, faplOptions, productOptions, clients, onClose, onDone }: {
  lead: LeadRow;
  faplOptions: Array<{ value: string; label: string }>;
  productOptions: ProductOpt[];
  clients: Array<Client & { id: string }>;
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const isPartner = lead.category === 'PARTNER_DSA';

  // Suggest an existing client if one already matches the lead's mobile/email.
  const suggested = useMemo(() => {
    const keys = new Set<string>();
    if (lead.mobile) keys.add(`m:${lead.mobile.replace(/[\s-]/g, '').replace(/^\+91/, '')}`);
    if (lead.email) keys.add(`e:${lead.email.trim().toLowerCase()}`);
    return clients.find((c) => (c.dupeKeys ?? []).some((k) => keys.has(k)));
  }, [clients, lead.mobile, lead.email]);

  const [mode, setMode] = useState<'existing' | 'new'>(suggested ? 'existing' : 'new');
  const [productId, setProductId] = useState(lead.productId ?? '');
  const [handlingRm, setHandlingRm] = useState(lead.assignedRm ?? '');
  const [existingClientId, setExistingClientId] = useState(suggested?.id ?? '');
  const [caseLookup, setCaseLookup] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const form = useClientForm(stateFromLead(lead));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clientOptions = useMemo(() =>
    clients.filter((c) => c.status !== 'BLACKLISTED').map((c) => ({
      value: c.id,
      label: `${c.name} · ${c.id}${c.primaryContact?.mobile ? ` · ${c.primaryContact.mobile}` : ''}`,
    })), [clients]);

  // Resolve an existing client from an old Case ID (FIN-CASE-…) or a Client ID.
  const resolveByCase = async () => {
    const id = caseLookup.trim();
    if (!id) return;
    setLookupBusy(true); setError('');
    try {
      const up = id.toUpperCase();
      if (up.startsWith('FCL-') || up.startsWith('CL-')) {   // FCL- (new) or legacy CL- client ids
        const cs = await getDoc(doc(db, 'clients', id));
        if (cs.exists()) { setExistingClientId(id); toast.success(`Client ${id} selected`); }
        else setError(`Client ${id} not found`);
      } else {
        const cs = await getDoc(doc(db, 'cases', id));
        const cid = cs.exists() ? (cs.data().clientId as string | undefined) : undefined;
        if (cid) { setExistingClientId(cid); toast.success(`Resolved to client ${cid}`); }
        else setError(`Case ${id} not found`);
      }
    } catch {
      setError('Lookup failed');
    } finally { setLookupBusy(false); }
  };

  const run = async () => {
    setError('');
    let body: Record<string, unknown>;
    if (isPartner) {
      body = { relationshipOwner: handlingRm || null };
    } else {
      if (!productId) { setError('Pick the product for the case'); return; }
      if (mode === 'existing') {
        if (!existingClientId) { setError('Select the existing client'); return; }
        body = { clientId: existingClientId, productId, handlingRm: handlingRm || null };
      } else {
        if (!form.validate()) { setError('Fix the highlighted client fields'); return; }
        body = { newClient: form.payload(), productId, handlingRm: handlingRm || null };
      }
    }
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; clientId?: string; caseId?: string; subDsaId?: string }>(
        'POST', `/api/crm2/leads/${lead.id}/convert`, body);
      if (r.subDsaId) {
        toast.success(`Sub-DSA ${r.subDsaId} created`);
        onClose(); onDone();
      } else {
        toast.success(`Converted → ${r.clientId} / ${r.caseId}`);
        onClose(); onDone();
        if (r.caseId) navigate(`/crm/pipeline/cases/${r.caseId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed');
    } finally { setBusy(false); }
  };

  const wide = !isPartner && mode === 'new';

  return (
    <div className="glass-modal-overlay fixed inset-0 z-60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`glass-modal-panel w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isPartner ? 'Convert to Sub DSA' : 'Convert Lead → Client + Case'}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {isPartner
              ? 'For a partner who will WORK CASES THEMSELVES using the code (high payout share). If they only refer files and we do the legwork, use Move to Partner funnel instead — that makes them a Connector.'
              : 'Resolve the client (new or existing), then open the case in one transaction.'}
          </p>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

          {!isPartner && (
            <>
              {/* Step 1 — new vs existing client */}
              <div className="grid grid-cols-2 gap-2">
                {(['existing', 'new'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className="px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
                    style={mode === m
                      ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
                      : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
                    {m === 'existing' ? 'Existing client' : 'New client'}
                  </button>
                ))}
              </div>

              {mode === 'existing' ? (
                <div className="space-y-3">
                  <div>
                    <FLabel text="Client" required />
                    <SearchableSelect value={existingClientId} onChange={setExistingClientId}
                      options={clientOptions} placeholder="Search by name / client id / mobile…" />
                    {suggested && existingClientId === suggested.id && (
                      <p className="text-[11px] mt-1" style={{ color: '#34d399' }}>Matched this lead’s contact automatically.</p>
                    )}
                  </div>
                  <div>
                    <FLabel text="…or resolve by old Case ID / Client ID" />
                    <div className="flex gap-2">
                      <input className={inp()} value={caseLookup} onChange={(e) => setCaseLookup(e.target.value)}
                        placeholder="FIN-CASE-2026-0001 or FCL-2026-00001" />
                      <button onClick={resolveByCase} disabled={lookupBusy || !caseLookup.trim()}
                        className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40"
                        style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
                        {lookupBusy ? '…' : 'Find'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <ClientFieldsGrid form={form} />
              )}

              {/* Step 2 — case basics */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <FLabel text="Product" required />
                  <SearchableSelect value={productId} onChange={setProductId} options={filterProductsByCat(productOptions, lead.category)} placeholder="Select product…" />
                </div>
                <div>
                  <FLabel text="Handling RM" />
                  <SearchableSelect value={handlingRm} onChange={setHandlingRm}
                    options={[{ value: '', label: lead.assignedRm ? `Lead RM (${lead.assignedRm})` : 'Me' }, ...faplOptions]}
                    placeholder="Default" />
                </div>
              </div>
            </>
          )}

          {isPartner && (
            <div>
              <FLabel text="Relationship Owner" />
              <SearchableSelect value={handlingRm} onChange={setHandlingRm}
                options={[{ value: '', label: lead.assignedRm ? `Lead RM (${lead.assignedRm})` : 'Me' }, ...faplOptions]}
                placeholder="Default" />
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={run} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
