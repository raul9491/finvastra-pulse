import { useState } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useProviders } from '../../hooks/useOpportunities';
import { createSubmission } from '../../hooks/useBankSubmissions';
import { Modal } from '../../../../components/ui/Modal';
import { SearchableSelect } from '../../../../components/ui/SearchableSelect';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  oppId: string;
  existingProviderIds: string[];  // already-submitted banks (to prevent duplicates)
  opportunityProduct: string;     // e.g. "Home Loan" — used to filter eligible banks
}

export function AddBankSubmissionModal({ isOpen, onClose, leadId, oppId, existingProviderIds, opportunityProduct }: Props) {
  const { user } = useAuth();
  const providers = useProviders();
  const banks = providers.filter((p) => {
    if (p.type !== 'bank' || !p.active) return false;
    // If provider has no eligibleProducts array, show it (backwards compat with old seed data)
    if (!p.eligibleProducts || p.eligibleProducts.length === 0) return true;
    return p.eligibleProducts.includes(opportunityProduct);
  });

  const [providerId, setProviderId]           = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [notes, setNotes]                     = useState('');
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState('');

  const reset = () => { setProviderId(''); setRequestedAmount(''); setNotes(''); setError(''); };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!providerId) { setError('Select a bank.'); return; }
    if (existingProviderIds.includes(providerId)) {
      setError('This bank has already been submitted for this opportunity.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createSubmission(
        leadId, oppId, providerId, notes,
        requestedAmount ? Number(requestedAmount) : undefined,
        user!.uid,
      );
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add submission.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full px-3.5 py-3 text-sm bg-(--shell-hover-soft) border border-(--shell-border-mid) rounded-lg outline-none focus:ring-2 focus:bg-(--ss-bg) transition-colors";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Submit to Bank"
      size="sm"
      footer={
        <>
          <button onClick={handleClose}
            className="px-5 py-2.5 text-sm border border-(--shell-border-mid) rounded-xl hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-primary)' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Add Submission'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-muted)' }}>Bank *</label>
          {banks.length === 0 ? (
            <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: '#FFF1F2', color: '#9F1239' }}>
              No banks configured for this loan type. Ask your admin to update provider settings.
            </div>
          ) : (
            <SearchableSelect
              options={banks.map((b) => ({
                value: b.id,
                label: b.name,
                description: existingProviderIds.includes(b.id) ? 'Already added' : undefined,
                disabled: existingProviderIds.includes(b.id),
              }))}
              value={providerId}
              onChange={(v) => setProviderId(v)}
              placeholder="Select bank…"
              emptyMessage="No banks match your search"
              label="Bank"
            />
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-muted)' }}>Requested Amount ₹</label>
          <input type="number" value={requestedAmount}
            onChange={(e) => setRequestedAmount(e.target.value)}
            placeholder="Optional — e.g. 5000000"
            className={inputClass} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} placeholder="Any bank-specific context…"
            className={`${inputClass} resize-none`} />
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    </Modal>
  );
}
