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
        className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        style={{ color: '#2A2A2A' }}
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
          <p className="text-sm font-semibold" style={{ color: '#166534' }}>
            Opportunity transferred successfully.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : specialists.length === 0 ? (
            <div className="rounded-lg px-4 py-5 text-sm text-center"
              style={{ backgroundColor: '#FFF7ED', color: '#9A3412', border: '1px solid #FED7AA' }}>
              No {VERTICAL_LABELS[opportunityType].toLowerCase()} specialists available.
              Ask admin to assign a Lead Convertor with the {VERTICAL_LABELS[opportunityType]} vertical.
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
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
                          ? { backgroundColor: '#EFF6FF', borderColor: '#1D4ED8', color: '#1D4ED8' }
                          : { backgroundColor: '#FAFAF7', borderColor: '#E2E8F0', color: '#0A0A0A' }
                      }
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{specialist.displayName}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                            {specialist.designation ?? 'Specialist'}
                          </p>
                        </div>
                        <span
                          className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                        >
                          {VERTICAL_LABELS[opportunityType]}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>
                  Transfer Note (optional)
                </p>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a handoff note…"
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
                  style={{ color: '#0A0A0A' }}
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-xs font-medium px-3 py-2 rounded-lg"
              style={{ backgroundColor: '#FFF1F2', color: '#9F1239' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
