import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Plus, Search, Edit2, Trash2, Handshake, Eye, EyeOff, IndianRupee, CheckCircle2,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../../components/ui/Modal';
import { maskPan, PAN_REGEX } from '../../crm/leads/panUtils';
import {
  useConnectors, nextConnectorCode, createConnector, updateConnector,
  getConnectorFinancial, deleteConnector, useConnectorPayouts,
  addConnectorPayout, markConnectorPayoutPaid, type ConnectorInput,
} from '../hooks/useConnectors';
import type { Connector, ConnectorVertical, ConnectorPayout } from '../../../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const VERTICALS: { key: ConnectorVertical; label: string; color: string }[] = [
  { key: 'loan',      label: 'Loan',      color: '#3B82F6' },
  { key: 'wealth',    label: 'Wealth',    color: '#10B981' },
  { key: 'insurance', label: 'Insurance', color: '#F59E0B' },
];
const VL: Record<ConnectorVertical, { label: string; color: string }> = {
  loan:      { label: 'Loan',      color: '#3B82F6' },
  wealth:    { label: 'Wealth',    color: '#10B981' },
  insurance: { label: 'Insurance', color: '#F59E0B' },
};
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const inp = 'w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border rounded-lg outline-none focus:border-(--shell-border-mid)';
const inpCls = (err?: string) => `${inp} ${err ? 'border-red-400' : 'border-(--shell-border)'}`;
const labelCls = 'block text-xs font-semibold uppercase tracking-widest mb-1';
const rupee = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

interface FormState {
  connectorCode: string; displayName: string; mobile: string; email: string;
  address: string; firmName: string; ownDsaCode: string; verticals: ConnectorVertical[];
  status: Connector['status']; notes: string;
  pan: string; accountHolderName: string; accountNumber: string; ifsc: string;
  bankName: string; branch: string;
}

function emptyForm(code: string): FormState {
  return {
    connectorCode: code, displayName: '', mobile: '', email: '', address: '',
    firmName: '', ownDsaCode: '', verticals: [], status: 'active', notes: '',
    pan: '', accountHolderName: '', accountNumber: '', ifsc: '', bankName: '', branch: '',
  };
}

function ConnectorFormModal({ connector, suggestedCode, uid, onClose }: {
  connector: Connector | null;          // null = add
  suggestedCode: string;
  uid: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    connector ? {
      connectorCode: connector.connectorCode, displayName: connector.displayName,
      mobile: connector.mobile, email: connector.email, address: connector.address,
      firmName: connector.firmName ?? '', ownDsaCode: connector.ownDsaCode ?? '', verticals: connector.verticals ?? [],
      status: connector.status, notes: connector.notes ?? '',
      pan: '', accountHolderName: '', accountNumber: '', ifsc: '', bankName: '', branch: '',
    } : emptyForm(suggestedCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});

  // Load existing financial details in edit mode.
  useEffect(() => {
    if (!connector) return;
    getConnectorFinancial(connector.id).then((f) => {
      if (!f) return;
      setForm((p) => ({
        ...p,
        pan: f.pan ?? '',
        accountHolderName: f.bank?.accountHolderName ?? '',
        accountNumber:     f.bank?.accountNumber ?? '',
        ifsc:              f.bank?.ifsc ?? '',
        bankName:          f.bank?.bankName ?? '',
        branch:            f.bank?.branch ?? '',
      }));
    }).catch(() => {});
  }, [connector]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errs[k]) setErrs((p) => { const n = { ...p }; delete n[k]; return n; });
  };
  const toggleVertical = (v: ConnectorVertical) => {
    setForm((p) => ({ ...p, verticals: p.verticals.includes(v) ? p.verticals.filter((x) => x !== v) : [...p.verticals, v] }));
    if (errs.verticals) setErrs((p) => { const n = { ...p }; delete n.verticals; return n; });
  };

  const handleSave = async () => {
    const e: Record<string, string> = {};
    if (!form.connectorCode.trim()) e.connectorCode = 'Required';
    if (!form.displayName.trim())   e.displayName = 'Required';
    const mob = form.mobile.replace(/\D/g, '');
    if (!mob)                       e.mobile = 'Required';
    else if (mob.length !== 10)     e.mobile = 'Enter a 10-digit mobile';
    if (form.verticals.length === 0) e.verticals = 'Pick at least one';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Invalid email';
    if (form.pan.trim() && !PAN_REGEX.test(form.pan.trim().toUpperCase())) e.pan = 'Invalid PAN (ABCDE1234F)';
    if (form.ifsc.trim() && !IFSC_REGEX.test(form.ifsc.trim().toUpperCase())) e.ifsc = 'Invalid IFSC';
    if (Object.keys(e).length) { setErrs(e); return; }

    setBusy(true); setError('');
    try {
      const input: ConnectorInput = {
        connectorCode: form.connectorCode.trim(),
        displayName: form.displayName.trim(),
        mobile: mob,
        email: form.email.trim(),
        address: form.address.trim(),
        firmName: form.firmName.trim() || undefined,
        ownDsaCode: form.ownDsaCode.trim() || undefined,
        verticals: form.verticals,
        status: form.status,
        notes: form.notes.trim() || undefined,
      };
      const financial = {
        pan: form.pan.trim().toUpperCase(),
        bank: {
          accountHolderName: form.accountHolderName.trim(),
          accountNumber: form.accountNumber.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          bankName: form.bankName.trim(),
          branch: form.branch.trim() || undefined,
        },
      };
      if (connector) await updateConnector(connector.id, input, financial);
      else await createConnector(input, financial, uid);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  };

  const sectionLabel = (t: string) => (
    <p className="text-xs font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--text-muted)' }}>{t}</p>
  );

  return (
    <Modal isOpen onClose={onClose} title={connector ? `Edit ${connector.connectorCode}` : 'Add Sub DSA'} size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl" style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleSave} disabled={busy}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {busy ? 'Saving…' : connector ? 'Save Changes' : 'Add Sub DSA'}
          </button>
        </>
      }>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: errs.connectorCode ? '#DC2626' : 'var(--text-muted)' }}>Sub DSA Code *</label>
            <input value={form.connectorCode} onChange={(e) => set('connectorCode', e.target.value)} className={inpCls(errs.connectorCode)} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value as Connector['status'])} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: errs.displayName ? '#DC2626' : 'var(--text-muted)' }}>Full Name *{errs.displayName && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.displayName}</span>}</label>
            <input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} className={inpCls(errs.displayName)} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: errs.mobile ? '#DC2626' : 'var(--text-muted)' }}>Mobile *{errs.mobile && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.mobile}</span>}</label>
            <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit" className={inpCls(errs.mobile)} style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: errs.email ? '#DC2626' : 'var(--text-muted)' }}>Email{errs.email && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.email}</span>}</label>
            <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="not a Workspace login" className={inpCls(errs.email)} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Firm / DSA Name</label>
            <input value={form.firmName} onChange={(e) => set('firmName', e.target.value)} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Their Own DSA Code</label>
            <input value={form.ownDsaCode} onChange={(e) => set('ownDsaCode', e.target.value)} placeholder="optional — only if they hold their own bank DSA code" className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Cases can run under Finvastra's code (we receive &amp; pay them) or their own code (bank pays them directly) — chosen per case in CRM.</p>
          </div>
        </div>

        <div>
          <label className={labelCls} style={{ color: errs.verticals ? '#DC2626' : 'var(--text-muted)' }}>Brings cases for *{errs.verticals && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.verticals}</span>}</label>
          <div className="flex gap-2">
            {VERTICALS.map((v) => {
              const on = form.verticals.includes(v.key);
              return (
                <button key={v.key} type="button" onClick={() => toggleVertical(v.key)}
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors"
                  style={{
                    borderColor: on ? v.color : 'var(--shell-border)',
                    backgroundColor: on ? `${v.color}1A` : 'transparent',
                    color: on ? v.color : 'var(--text-muted)',
                  }}>
                  {on ? '✓ ' : ''}{v.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Address</label>
          <textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2}
            className={`${inp} border-(--shell-border) resize-none`} style={{ color: 'var(--text-primary)' }} />
        </div>

        {sectionLabel('Financial — PAN & bank (admin/HR only)')}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: errs.pan ? '#DC2626' : 'var(--text-muted)' }}>PAN{errs.pan && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.pan}</span>}</label>
            <input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} className={inpCls(errs.pan)} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Account Holder Name</label>
            <input value={form.accountHolderName} onChange={(e) => set('accountHolderName', e.target.value)} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Account Number</label>
            <input value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: errs.ifsc ? '#DC2626' : 'var(--text-muted)' }}>IFSC{errs.ifsc && <span className="ml-2 text-red-500 normal-case font-medium">— {errs.ifsc}</span>}</label>
            <input value={form.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" maxLength={11} className={inpCls(errs.ifsc)} style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Bank Name</label>
            <input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Branch</label>
            <input value={form.branch} onChange={(e) => set('branch', e.target.value)} className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>

        <div>
          <label className={labelCls} style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
            className={`${inp} border-(--shell-border) resize-none`} style={{ color: 'var(--text-primary)' }} />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Detail modal (financial + payouts) ───────────────────────────────────────

function PayoutRow({ payout, uid }: { payout: ConnectorPayout; uid: string }) {
  const [paying, setPaying] = useState(false);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  const markPaid = async () => {
    setBusy(true);
    try { await markConnectorPayoutPaid(payout.id, uid, ref.trim()); }
    finally { setBusy(false); setPaying(false); }
  };

  return (
    <div className="border border-(--shell-border) rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{payout.caseLabel}</p>
          <p className="text-[11px] mt-0.5" style={{ color: VL[payout.businessLine].color }}>{VL[payout.businessLine].label}</p>
          {payout.notes && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{payout.notes}</p>}
          {payout.status === 'paid' && payout.paymentReference && (
            <p className="text-[11px] mt-1" style={{ color: '#059669' }}>Ref: {payout.paymentReference}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{rupee(payout.amount)}</p>
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ backgroundColor: payout.status === 'paid' ? '#D1FAE5' : '#FEF3C7', color: payout.status === 'paid' ? '#065F46' : '#92400E' }}>
            {payout.status}
          </span>
        </div>
      </div>
      {payout.status === 'pending' && (
        paying ? (
          <div className="flex gap-2 mt-2">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Payment reference / UTR"
              className={`${inp} border-(--shell-border) text-xs py-1.5`} style={{ color: 'var(--text-primary)' }} />
            <button onClick={markPaid} disabled={busy} className="text-xs font-semibold px-3 rounded-lg shrink-0" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {busy ? '…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <button onClick={() => setPaying(true)} className="text-xs font-semibold mt-2" style={{ color: '#059669' }}>
            Mark as paid →
          </button>
        )
      )}
    </div>
  );
}

function ConnectorDetailModal({ connector, uid, onEdit, onClose }: {
  connector: Connector; uid: string; onEdit: () => void; onClose: () => void;
}) {
  const { payouts } = useConnectorPayouts(connector.id);
  const [pan, setPan] = useState('');
  const [bank, setBank] = useState<{ accountHolderName?: string; accountNumber?: string; ifsc?: string; bankName?: string; branch?: string } | null>(null);
  const [showPan, setShowPan] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    getConnectorFinancial(connector.id).then((f) => { if (f) { setPan(f.pan ?? ''); setBank(f.bank ?? null); } }).catch(() => {});
  }, [connector.id]);

  const pendingTotal = payouts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const paidTotal    = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-right" style={{ color: 'var(--text-primary)' }}>{value || '—'}</span>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={`${connector.connectorCode} · ${connector.displayName}`} size="lg"
      footer={
        <button onClick={onEdit} className="px-5 py-2.5 text-sm font-semibold rounded-xl flex items-center gap-2" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          <Edit2 size={14} /> Edit
        </button>
      }>
      <div className="space-y-5">
        {/* verticals + status */}
        <div className="flex items-center gap-2 flex-wrap">
          {connector.verticals.map((v) => (
            <span key={v} className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
              style={{ backgroundColor: `${VL[v].color}1A`, color: VL[v].color }}>{VL[v].label}</span>
          ))}
          <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={{ backgroundColor: connector.status === 'active' ? '#D1FAE5' : 'var(--shell-hover-hard)', color: connector.status === 'active' ? '#065F46' : '#64748B' }}>
            {connector.status}
          </span>
        </div>

        {/* contact */}
        <div className="bg-(--glass-panel-bg) rounded-xl border border-(--shell-border) p-4">
          {row('Mobile', connector.mobile)}
          {row('Email', connector.email)}
          {row('Firm / DSA', connector.firmName)}
          {row('Own DSA Code', connector.ownDsaCode)}
          {row('Address', connector.address)}
          {connector.notes && row('Notes', connector.notes)}
        </div>

        {/* financial */}
        <div className="bg-(--glass-panel-bg) rounded-xl border border-(--shell-border) p-4">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Financial</p>
          {row('PAN', pan ? (
            <span className="inline-flex items-center gap-2 font-mono">
              {showPan ? pan : maskPan(pan)}
              <button onClick={() => setShowPan((s) => !s)} style={{ color: 'var(--text-muted)' }}>
                {showPan ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </span>
          ) : '')}
          {row('Account Holder', bank?.accountHolderName)}
          {row('Account No.', bank?.accountNumber ? <span className="font-mono">{bank.accountNumber}</span> : '')}
          {row('IFSC', bank?.ifsc ? <span className="font-mono">{bank.ifsc}</span> : '')}
          {row('Bank', [bank?.bankName, bank?.branch].filter(Boolean).join(' · '))}
        </div>

        {/* payouts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Payouts</p>
            <button onClick={() => setAdding((a) => !a)} className="text-xs font-semibold flex items-center gap-1" style={{ color: '#C9A961' }}>
              <Plus size={13} /> Add payout
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-xl p-3" style={{ backgroundColor: '#FEF3C7' }}>
              <p className="text-lg font-bold" style={{ color: '#92400E' }}>{rupee(pendingTotal)}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#92400E' }}>Pending</p>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: '#D1FAE5' }}>
              <p className="text-lg font-bold" style={{ color: '#065F46' }}>{rupee(paidTotal)}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#065F46' }}>Paid</p>
            </div>
          </div>

          {adding && <AddPayoutForm connector={connector} uid={uid} onDone={() => setAdding(false)} />}

          <div className="space-y-2">
            {payouts.length === 0 && !adding && (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>No payouts recorded yet.</p>
            )}
            {payouts.map((p) => <PayoutRow key={p.id} payout={p} uid={uid} />)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AddPayoutForm({ connector, uid, onDone }: { connector: Connector; uid: string; onDone: () => void }) {
  const verts = connector.verticals.length ? connector.verticals : (['loan'] as ConnectorVertical[]);
  const [businessLine, setBusinessLine] = useState<ConnectorVertical>(verts[0]);
  const [caseLabel, setCaseLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!caseLabel.trim()) { setErr('Case reference is required'); return; }
    if (!amount || Number(amount) <= 0) { setErr('Enter an amount'); return; }
    setBusy(true); setErr('');
    try {
      await addConnectorPayout(connector, {
        businessLine, caseLabel: caseLabel.trim(), amount: Number(amount), notes: notes.trim() || undefined,
      }, uid);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  };

  return (
    <div className="border border-(--shell-border) rounded-xl p-3 mb-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <select value={businessLine} onChange={(e) => setBusinessLine(e.target.value as ConnectorVertical)}
          className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }}>
          {verts.map((v) => <option key={v} value={v}>{VL[v].label}</option>)}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Amount ₹"
          className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
      </div>
      <input value={caseLabel} onChange={(e) => setCaseLabel(e.target.value)} placeholder="Case reference (loan no / customer / app no)"
        className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
        className={`${inp} border-(--shell-border)`} style={{ color: 'var(--text-primary)' }} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-(--shell-border)" style={{ color: 'var(--text-muted)' }}>Cancel</button>
        <button onClick={save} disabled={busy} className="text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          {busy ? 'Adding…' : 'Add payout'}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ConnectorsPage() {
  const { user, profile } = useAuth();
  const { connectors, loading } = useConnectors();

  const [search, setSearch] = useState('');
  const [vfilter, setVfilter] = useState<ConnectorVertical | 'all'>('all');
  const [sfilter, setSfilter] = useState<Connector['status'] | 'all'>('all');
  const [formFor, setFormFor] = useState<Connector | null | 'new'>(null);
  const [detailFor, setDetailFor] = useState<Connector | null>(null);
  const [allPayouts, setAllPayouts] = useState<ConnectorPayout[]>([]);

  // Pending-payout totals per connector for the list.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'connector_payouts'),
      (snap) => setAllPayouts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConnectorPayout)),
      () => setAllPayouts([]));
    return unsub;
  }, []);

  const pendingByConnector = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allPayouts) if (p.status === 'pending') m.set(p.connectorId, (m.get(p.connectorId) ?? 0) + p.amount);
    return m;
  }, [allPayouts]);

  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const filtered = connectors.filter((c) => {
    if (vfilter !== 'all' && !c.verticals.includes(vfilter)) return false;
    if (sfilter !== 'all' && c.status !== sfilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.displayName.toLowerCase().includes(q) || c.connectorCode.toLowerCase().includes(q)
        || c.mobile.includes(q) || (c.firmName ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const totalPending = allPayouts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const activeCount = connectors.filter((c) => c.status === 'active').length;
  const suggestedCode = nextConnectorCode(connectors);
  const uid = user?.uid ?? '';
  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Sub DSA
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Channel partners who source loan, insurance &amp; wealth cases — their name populates when you add a case in CRM
          </p>
        </div>
        <button onClick={() => setFormFor('new')}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl shrink-0"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          <Plus size={15} /> Add Sub DSA
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Sub DSAs', value: String(connectors.length), color: 'var(--text-primary)', icon: Handshake },
          { label: 'Active',           value: String(activeCount),       color: '#065F46', icon: CheckCircle2 },
          { label: 'Pending Payouts',  value: rupee(totalPending),       color: '#92400E', icon: IndianRupee },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4 flex items-center gap-3">
            <Icon size={18} style={{ color }} />
            <div>
              <p className="text-xl font-bold" style={{ color }}>{value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, mobile, firm…"
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none" style={{ color: 'var(--text-primary)' }} />
        </div>
        <select value={vfilter} onChange={(e) => setVfilter(e.target.value as ConnectorVertical | 'all')}
          className="px-3 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg" style={{ color: 'var(--text-primary)' }}>
          <option value="all">All verticals</option>
          {VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <select value={sfilter} onChange={(e) => setSfilter(e.target.value as Connector['status'] | 'all')}
          className="px-3 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg" style={{ color: 'var(--text-primary)' }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Code</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Name</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Verticals</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Mobile</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Pending ₹</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}>Status</th>
                <th className={thCls} style={{ color: 'var(--text-muted)' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No Sub DSAs yet. Click <strong>Add Sub DSA</strong> to onboard one.
                </td></tr>
              )}
              {filtered.map((c) => {
                const pending = pendingByConnector.get(c.id) ?? 0;
                return (
                  <tr key={c.id} onClick={() => setDetailFor(c)}
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderBottom: '1px solid var(--shell-border)', opacity: c.status === 'inactive' ? 0.55 : 1 }}>
                    <td className="px-4 py-3 text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{c.connectorCode}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                      {c.displayName}{c.firmName && <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.firmName}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.verticals.map((v) => (
                          <span key={v} className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: `${VL[v].color}1A`, color: VL[v].color }}>{VL[v].label.slice(0, 4)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{c.mobile}</td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: pending > 0 ? '#92400E' : 'var(--text-muted)' }}>{pending > 0 ? rupee(pending) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: c.status === 'active' ? '#D1FAE5' : 'var(--shell-hover-hard)', color: c.status === 'active' ? '#065F46' : '#64748B' }}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setFormFor(c)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" title="Edit" style={{ color: 'var(--text-muted)' }}><Edit2 size={14} /></button>
                      <button onClick={() => { if (window.confirm(`Remove ${c.displayName}? Their payout history is kept.`)) deleteConnector(c.id); }}
                        className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" title="Remove" style={{ color: '#DC2626' }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
        Sub DSAs have no Google Workspace login. Their PAN &amp; bank details are visible to admin/HR only and are used for payouts.
      </p>

      {/* Modals */}
      {formFor && (
        <ConnectorFormModal
          connector={formFor === 'new' ? null : formFor}
          suggestedCode={suggestedCode}
          uid={uid}
          onClose={() => setFormFor(null)}
        />
      )}
      {detailFor && (
        <ConnectorDetailModal
          connector={connectors.find((c) => c.id === detailFor.id) ?? detailFor}
          uid={uid}
          onEdit={() => { setFormFor(detailFor); setDetailFor(null); }}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}
