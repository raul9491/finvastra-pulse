import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { transferOpportunity } from '../hooks/useOpportunities';
import { useAuth } from '../../auth/AuthContext';
import type { OpportunityType } from '../../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  opportunityId: string;
  opportunityType: OpportunityType;
}

const VERTICAL_LABELS: Record<OpportunityType, string> = {
  loan:      'Loan',
  wealth:    'Wealth',
  insurance: 'Insurance',
};

export function TransferModal({ isOpen, onClose, leadId, opportunityId, opportunityType }: Props) {
  const { user } = useAuth();
  const { employees, loading } = useAllEmployees();

  const [selectedId, setSelectedId]   = useState<string>('');
  const [note, setNote]               = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  // Filter to matching lead_convertor specialists
  const specialists = employees.filter(
    (e) =>
      e.crmRole === 'lead_convertor' &&
      e.convertorVertical === opportunityType &&
      e.crmAccess === true,
  );

  const handleConfirm = async () => {
    if (!selectedId || !user) return;
    setSubmitting(true);
    setError(null);
    try {
      await transferOpportunity(leadId, opportunityId, selectedId, user.uid);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedId('');
        setNote('');
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <button
        onClick={onClose}
        disabled={submitting}
        className="px-4 py-2 text-sm border rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
        style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}
      >
        Cancel
      </button>
      <button
        onClick={handleConfirm}
        disabled={!selectedId || submitting}
        className="px-5 py-2 text-sm font-semibold rounded-lg transition-opacity disabled:opacity-40"
        style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
      >
        {submitting ? 'Transferring…' : 'Confirm Transfer'}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Transfer to ${VERTICAL_LABELS[opportunityType]} Specialist`}
      size="sm"
      footer={footer}
    >
      {success ? (
        <div className="py-6 text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--status-success)' }}>
            Opportunity transferred successfully.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 rounded-lg animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              ))}
            </div>
          ) : specialists.length === 0 ? (
            <div className="rounded-lg px-4 py-5 text-sm text-center"
              style={{ backgroundColor: 'rgba(251,146,60,0.10)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}>
              No {VERTICAL_LABELS[opportunityType].toLowerCase()} specialists available.
              Ask admin to assign a Lead Convertor with the {VERTICAL_LABELS[opportunityType]} vertical.
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Select Specialist
              </p>
              <div className="space-y-2">
                {specialists.map((specialist) => {
                  const isSelected = selectedId === specialist.userId;
                  return (
                    <button
                      key={specialist.userId}
                      onClick={() => setSelectedId(specialist.userId)}
                      className="w-full text-left px-4 py-3 rounded-lg border transition-all"
                      style={
                        isSelected
                          ? { backgroundColor: 'rgba(96,165,250,0.15)', borderColor: '#60a5fa', color: '#60a5fa' }
                          : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)', color: 'var(--text-primary)' }
                      }
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{specialist.displayName}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {specialist.designation ?? 'Specialist'}
                          </p>
                        </div>
                        <span className="badge-glass-success">
                          {VERTICAL_LABELS[opportunityType]}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                  Transfer Note (optional)
                </p>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a handoff note…"
                  className="glass-inp w-full text-sm"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-xs font-medium px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.20)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
