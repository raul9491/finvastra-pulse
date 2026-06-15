/**
 * Crm2ClientDetailPage — the Client Master workspace for one FCL- client.
 * Profile-completion header, §4.1 detail card (+ edit), RM assignment
 * (manager/admin), loan + product history (cases by clientId), open-new-case,
 * and a read-only document vault. Reads are rule-scoped; writes via /api/crm2.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  collection, doc, onSnapshot, query, where, orderBy,
} from 'firebase/firestore';
import { ArrowLeft, Pencil, UserCog, FolderOpen, Plus, X, FileText } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel } from '../masters/MastersPage';
import { ClientFormModal, clientCompletionPct, CONSTITUTION_OPTS } from './ClientFormModal';
import { STAGE_LABEL } from '../cases/Crm2CasesPage';
import type { Client, Crm2Case, VaultDoc, Product, CaseStage } from '../../../types/crm2';

type WithId<T> = T & { id: string };

const constLabel = (v: string) => CONSTITUTION_OPTS.find((o) => o.value === v)?.label ?? v;
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: 'rgba(52,211,153,0.14)', fg: '#34d399' },
  INACTIVE: { bg: 'var(--shell-hover-hard)', fg: 'var(--text-muted)' },
  BLACKLISTED: { bg: 'rgba(248,113,113,0.14)', fg: '#f87171' },
};
const fmtDate = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN')}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{children ?? '—'}</p>
    </div>
  );
}

export function Crm2ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const { employees } = useAllEmployees();
  const { rows: products } = useCrm2Collection<WithId<Product>>('products');

  const [client, setClient] = useState<WithId<Client> | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cases, setCases] = useState<WithId<Crm2Case>[]>([]);
  const [vault, setVault] = useState<WithId<VaultDoc>[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showOpenCase, setShowOpenCase] = useState(false);
  const [assignRm, setAssignRm] = useState('');
  const [busy, setBusy] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const myFapl = profile?.employeeId;
  const canSee = hasCrm2Perm(profile, 'crm.leads.read') || hasCrm2Perm(profile, 'crm.cases.read') || isAdmin;
  const canWrite = hasCrm2Perm(profile, 'crm.cases.write');
  const canManage = isAdmin || profile?.crmRole === 'manager';

  // Single client doc
  useEffect(() => {
    if (!clientId) return;
    return onSnapshot(doc(db, 'clients', clientId), (s) => {
      if (!s.exists()) { setNotFound(true); setClient(null); }
      else { setClient({ id: s.id, ...s.data() } as WithId<Client>); setNotFound(false); }
    }, () => setNotFound(true));
  }, [clientId]);

  // Loan + product history (cases for this client)
  useEffect(() => {
    if (!clientId) return;
    const qy = query(collection(db, 'cases'), where('clientId', '==', clientId), orderBy('createdAt', 'desc'));
    return onSnapshot(qy,
      (snap) => setCases(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<Crm2Case>)),
      () => setCases([]));
  }, [clientId]);

  // Document vault (read-only)
  useEffect(() => {
    if (!clientId) return;
    return onSnapshot(collection(db, 'clients', clientId, 'vaultDocs'),
      (snap) => setVault(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<VaultDoc>)),
      () => setVault([]));
  }, [clientId]);

  const faplOptions = useMemo(() =>
    employees.filter((e) => e.employeeStatus !== 'inactive' && e.employeeId)
      .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` })),
    [employees]);
  const rmName = (fapl: string | null | undefined) =>
    fapl ? (employees.find((e) => e.employeeId === fapl)?.displayName ?? fapl) : '—';
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const canEditDetails = isAdmin || (!!myFapl && client?.ownerRm === myFapl);

  const runAssign = async () => {
    if (!assignRm) { toast.error('Pick an RM'); return; }
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/clients/${clientId}`, { ownerRm: assignRm });
      toast.success('Owner RM updated');
      setShowAssign(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  const toggleBlacklist = async () => {
    if (!client) return;
    const next = client.status === 'BLACKLISTED' ? 'ACTIVE' : 'BLACKLISTED';
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/clients/${clientId}`, { status: next });
      toast.success(next === 'BLACKLISTED' ? 'Client blacklisted' : 'Client reactivated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  if (notFound) {
    return (
      <div className="max-w-3xl">
        <Link to="/crm/pipeline/clients" className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} /> Clients
        </Link>
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Client {clientId} not found.</div>
      </div>
    );
  }
  if (!canSee) {
    return <div className="glass-panel p-10 text-center text-sm max-w-3xl" style={{ color: 'var(--text-muted)' }}>You don’t have access to this client.</div>;
  }
  if (!client) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    );
  }

  const pct = clientCompletionPct(client);
  const sc = STATUS_COLOR[client.status] ?? STATUS_COLOR.INACTIVE;

  return (
    <div className="space-y-5 max-w-4xl">
      <Link to="/crm/pipeline/clients" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={14} /> Clients
      </Link>

      {/* Header */}
      <div className="glass-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
                {client.name}
              </h2>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: sc.bg, color: sc.fg }}>{client.status}</span>
            </div>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {client.id} · {constLabel(client.constitution)} · Owner {rmName(client.ownerRm)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canEditDetails && (
              <button onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border"
                style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
                <Pencil size={13} /> Edit
              </button>
            )}
            {canManage && (
              <button onClick={() => { setAssignRm(client.ownerRm ?? ''); setShowAssign(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border"
                style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
                <UserCog size={13} /> Assign RM
              </button>
            )}
            {canWrite && client.status !== 'BLACKLISTED' && (
              <button onClick={() => setShowOpenCase(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                <Plus size={13} /> Open Case
              </button>
            )}
            {canManage && (
              <button onClick={toggleBlacklist} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50"
                style={{ borderColor: client.status === 'BLACKLISTED' ? 'var(--shell-border)' : 'rgba(248,113,113,0.4)', color: client.status === 'BLACKLISTED' ? 'var(--text-primary)' : '#f87171' }}>
                {client.status === 'BLACKLISTED' ? 'Reactivate' : 'Blacklist'}
              </button>
            )}
          </div>
        </div>
        {/* Profile completion */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Profile completion</span>
            <span className="text-xs font-semibold" style={{ color: pct >= 80 ? '#34d399' : pct >= 50 ? '#C9A961' : '#f87171' }}>{pct}%</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? '#34d399' : pct >= 50 ? '#C9A961' : '#f87171' }} />
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Industry">{client.industry || '—'}</Field>
          <Field label="PAN">{client.panLast4 ? `••••••${client.panLast4}` : '—'}</Field>
          <Field label="GSTIN">{client.gstin || '—'}</Field>
          <Field label="Udyam">{client.udyam || '—'}</Field>
          <Field label="CIN">{client.cin || '—'}</Field>
          <Field label="Incorporation / DOB">{fmtDate(client.incorporationDate)}</Field>
          <Field label="Contact">{client.primaryContact?.name || '—'}</Field>
          <Field label="Mobile">{client.primaryContact?.mobile || '—'}</Field>
          <Field label="Email">{client.primaryContact?.email || '—'}</Field>
          <Field label="KYC">{client.kycStatus}</Field>
          <Field label="Latest CIBIL">{client.latestCibil ? `${client.latestCibil.score} (${fmtDate(client.latestCibil.pulledAt)})` : '—'}</Field>
          <Field label="Registered Address">
            {[client.regAddress?.line, client.regAddress?.city, client.regAddress?.state, client.regAddress?.pincode].filter(Boolean).join(', ') || '—'}
          </Field>
        </div>
        {(client.existingRelationships?.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Existing Banking & Loans</p>
            <div className="space-y-1">
              {client.existingRelationships.map((r, i) => (
                <div key={i} className="text-xs flex flex-wrap gap-x-3" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.bank}</span>
                  <span>{r.facility}</span>
                  <span>O/s {fmtMoney(r.outstanding)}</span>
                  <span>EMI {fmtMoney(r.emi)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loan + product history */}
      <div className="glass-panel p-0 overflow-hidden">
        <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <FolderOpen size={15} style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Loan &amp; Product History ({cases.length})</p>
        </div>
        {cases.length === 0 ? (
          <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No cases yet for this client.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left font-semibold px-5 py-2.5">Case</th>
                  <th className="text-left font-semibold px-3 py-2.5">Product</th>
                  <th className="text-right font-semibold px-3 py-2.5">Requested</th>
                  <th className="text-right font-semibold px-3 py-2.5">Disbursed</th>
                  <th className="text-left font-semibold px-3 py-2.5">Opened</th>
                  <th className="text-left font-semibold px-3 py-2.5">Stage</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/crm/pipeline/cases/${c.id}`)}
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderTop: '1px solid var(--shell-border)' }}>
                    <td className="px-5 py-2.5 font-mono text-xs" style={{ color: '#C9A961' }}>{c.id}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{productName(c.productId)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>{fmtMoney(c.amountRequested)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: c.amountDisbursed ? '#34d399' : 'var(--text-muted)' }}>{fmtMoney(c.amountDisbursed)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(c.keyDates?.opened)}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
                        {STAGE_LABEL[c.stage as CaseStage] ?? c.stage}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document vault (read-only) */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={15} style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Document Vault ({vault.length})</p>
        </div>
        {vault.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No vault documents. Documents uploaded on a case are reused here.</p>
        ) : (
          <div className="space-y-1.5">
            {vault.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
                <span style={{ color: 'var(--text-primary)' }}>{v.fileName}</span>
                <span className="font-semibold" style={{ color: v.status === 'VALID' ? '#34d399' : v.status === 'EXPIRED' ? '#f87171' : 'var(--text-muted)' }}>{v.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showEdit && (
        <ClientFormModal mode="edit" client={client} canAssignRm={false} faplOptions={faplOptions}
          onClose={() => setShowEdit(false)} onSaved={() => setShowEdit(false)} />
      )}
      {showAssign && (
        <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAssign(false)}>
          <div className="glass-modal-panel w-full max-w-sm rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="glass-modal-header flex items-center justify-between px-5 py-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Assign Owner RM</h3>
              <button onClick={() => setShowAssign(false)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <FLabel text="Owner RM" />
                <SearchableSelect value={assignRm} onChange={setAssignRm} options={faplOptions} placeholder="Select RM…" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowAssign(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={runAssign} disabled={busy} className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Saving…' : 'Assign'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showOpenCase && (
        <OpenCaseModal clientId={client.id} clientOwner={client.ownerRm}
          products={products} faplOptions={faplOptions}
          onClose={() => setShowOpenCase(false)} onCreated={(id) => navigate(`/crm/pipeline/cases/${id}`)} />
      )}
    </div>
  );
}

// ─── Open new case for this client ────────────────────────────────────────────
function OpenCaseModal({ clientId, clientOwner, products, faplOptions, onClose, onCreated }: {
  clientId: string; clientOwner: string;
  products: WithId<Product>[];
  faplOptions: Array<{ value: string; label: string }>;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [productId, setProductId] = useState('');
  const [handlingRm, setHandlingRm] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!productId) { setErr('Pick a product'); return; }
    setErr(''); setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; caseId: string }>('POST', '/api/crm2/cases', {
        clientId, productId, handlingRm: handlingRm || null,
        amountRequested: amount ? Number(amount) : null,
      });
      toast.success(`Case ${r.caseId} opened`);
      onClose(); onCreated(r.caseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-sm rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Open New Case</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-4">
          {err && <p className="text-sm" style={{ color: '#f87171' }}>{err}</p>}
          <div>
            <FLabel text="Product" required />
            <SearchableSelect value={productId} onChange={setProductId} placeholder="Select product…"
              options={products.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` }))} />
          </div>
          <div>
            <FLabel text="Handling RM" />
            <SearchableSelect value={handlingRm} onChange={setHandlingRm}
              options={[{ value: '', label: `Client owner (${clientOwner})` }, ...faplOptions]} placeholder="Client owner (default)" />
          </div>
          <div>
            <FLabel text="Amount Requested ₹" />
            <input type="number" className="glass-inp w-full text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Opening…' : 'Open Case'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
