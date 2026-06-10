import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useBankSubmissions } from '../../hooks/useBankSubmissions';
import { useProviders } from '../../hooks/useOpportunities';
import { BankSubmissionCard } from './BankSubmissionCard';
import { AddBankSubmissionModal } from './AddBankSubmissionModal';
import type { BankSubmission } from '../../../../types';

interface Props {
  leadId: string;
  oppId: string;
  oppOwnerId: string;
  opportunityProduct: string;  // passed through to AddBankSubmissionModal for bank filtering
}

export function BankSubmissionsSection({ leadId, oppId, oppOwnerId, opportunityProduct }: Props) {
  const { user, profile } = useAuth();
  const { submissions, loading } = useBankSubmissions(leadId, oppId);
  const providers = useProviders();
  const [modalOpen, setModalOpen] = useState(false);

  const canAdd = profile?.role === 'admin' || user?.uid === oppOwnerId;

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const existingProviderIds = submissions.map((s) => s.providerId);

  return (
    <>
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border-mid) p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Bank Submissions ({submissions.length})
          </h3>
          {canAdd && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              <Plus size={14} /> Submit to Bank
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((i) => <div key={i} className="h-20 bg-(--shell-hover-hard) rounded-xl" />)}
          </div>
        ) : submissions.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-(--shell-border-mid) rounded-xl">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No bank submissions yet.</p>
            {canAdd && (
              <button onClick={() => setModalOpen(true)}
                className="mt-2 text-sm font-semibold underline" style={{ color: '#0B1538' }}>
                Submit to a bank →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => {
              const provider = providerMap.get(sub.providerId);
              const slaBreached = (sub as BankSubmission & { slaBreached?: boolean }).slaBreached;
              return (
                <div key={sub.id}>
                  <BankSubmissionCard
                    submission={sub}
                    provider={provider}
                    leadId={leadId}
                    oppId={oppId}
                  />
                  {slaBreached && (
                    <p
                      className="mt-1 ml-1 text-xs flex items-center gap-1"
                      style={{ color: '#92400E' }}
                    >
                      ⏰ SLA breached — follow up with bank
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddBankSubmissionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        leadId={leadId}
        oppId={oppId}
        existingProviderIds={existingProviderIds}
        opportunityProduct={opportunityProduct}
      />
    </>
  );
}
