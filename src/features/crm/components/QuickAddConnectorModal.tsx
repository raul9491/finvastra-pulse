/**
 * QuickAddConnectorModal — register a new connector (channel partner / DSA)
 * directly from CRM, without waiting for HR.
 *
 * Connectors walk in with cases; the RM adding the case can create the
 * connector on the spot and link it immediately. Only the main record is
 * created here — PAN + bank details (the admin/HR-only /private financial
 * sub-doc) are completed later in HRMS → Connectors before any payout.
 *
 * Used beside the "Sourced by Connector" pickers on NewLeadPage and
 * AddOpportunityPage.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Connector, ConnectorVertical } from '../../../types';
import {
  nextConnectorCode, quickAddConnector, type QuickConnectorInput,
} from '../../hrms/hooks/useConnectors';

const VERTICAL_LABELS: Record<ConnectorVertical, string> = {
  loan: 'Loan', wealth: 'Wealth', insurance: 'Insurance',
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing connectors — used to derive the next FAC-### code. */
  connectors: Connector[];
  /** Pre-tick a vertical (e.g. the business line of the case being added). */
  defaultVertical?: ConnectorVertical;
  uid: string;
  /** Called with the new connector's id so the caller can auto-select it. */
  onCreated: (id: string) => void;
}

export function QuickAddConnectorModal({
  open, onClose, connectors, defaultVertical, uid, onCreated,
}: Props) {
  const [form, setForm] = useState<QuickConnectorInput>({
    displayName: '', mobile: '', email: '', firmName: '', ownDsaCode: '',
    verticals: defaultVertical ? [defaultVertical] : [],
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const code = nextConnectorCode(connectors);

  const set = (k: keyof QuickConnectorInput, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (fieldErrors[k]) setFieldErrors((prev) => { const n = { ...prev }; delete n[k]; return n; });
  };

  const toggleVertical = (v: ConnectorVertical) => {
    setForm((p) => ({
      ...p,
      verticals: p.verticals.includes(v) ? p.verticals.filter((x) => x !== v) : [...p.verticals, v],
    }));
    if (fieldErrors.verticals) setFieldErrors((prev) => { const n = { ...prev }; delete n.verticals; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!form.displayName.trim()) errs.displayName = 'Required';
    const mobile = form.mobile.replace(/[\s-]/g, '').replace(/^\+91/, '');
    if (!mobile) errs.mobile = 'Required';
    else if (!/^[6-9]\d{9}$/.test(mobile)) errs.mobile = '10-digit Indian mobile';
    if (form.verticals.length === 0) errs.verticals = 'Pick at least one';
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setServerError('');
    setSaving(true);
    try {
      const id = await quickAddConnector({ ...form, mobile }, code, uid);
      onCreated(id);
      onClose();
      setForm({ displayName: '', mobile: '', email: '', firmName: '', ownDsaCode: '',
        verticals: defaultVertical ? [defaultVertical] : [] });
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to add connector.');
    } finally {
      setSaving(false);
    }
  };

  const inp = (field?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 transition-colors bg-(--ss-bg) ${
      field && fieldErrors[field]
        ? 'border-red-400 focus:ring-red-200/50'
        : 'border-(--shell-border) focus:ring-[#C9A961]'}`;

  const fLabel = (text: string, field?: string, required = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: field && fieldErrors[field] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {field && fieldErrors[field] && (
        <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">
          — {fieldErrors[field]}
        </span>
      )}
    </label>
  );

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>

        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>New Sub DSA</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Code <span className="font-mono font-semibold" style={{ color: '#C9A961' }}>{code}</span> · PAN &amp; bank details added later by HR
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard) transition-colors" aria-label="Close">
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

          <div>
            {fLabel('Full Name', 'displayName', true)}
            <input className={inp('displayName')} value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)} placeholder="Sub DSA's name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {fLabel('Mobile', 'mobile', true)}
              <input className={inp('mobile')} value={form.mobile} maxLength={13}
                onChange={(e) => set('mobile', e.target.value)} placeholder="9876543210" />
            </div>
            <div>
              {fLabel('Email')}
              <input className={inp()} type="email" value={form.email}
                onChange={(e) => set('email', e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div>
            {fLabel('Firm / DSA Entity')}
            <input className={inp()} value={form.firmName}
              onChange={(e) => set('firmName', e.target.value)} placeholder="optional" />
          </div>

          <div>
            {fLabel('Verticals', 'verticals', true)}
            <div className="flex gap-2">
              {(Object.keys(VERTICAL_LABELS) as ConnectorVertical[]).map((v) => {
                const on = form.verticals.includes(v);
                return (
                  <button key={v} type="button" onClick={() => toggleVertical(v)}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                    style={on
                      ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
                      : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
                    {on ? '✓ ' : ''}{VERTICAL_LABELS[v]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            {fLabel('Their Own DSA Code')}
            <input className={inp()} value={form.ownDsaCode}
              onChange={(e) => set('ownDsaCode', e.target.value)} placeholder="optional — if they hold their own bank code" />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Leave blank if their cases run under Finvastra's DSA code.
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {saving ? 'Adding…' : 'Add Sub DSA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
