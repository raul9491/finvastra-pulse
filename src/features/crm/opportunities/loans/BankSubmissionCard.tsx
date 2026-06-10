import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronRight, Star } from 'lucide-react';
import type { BankSubmission, BankSubmissionStatus, DocumentStatus, Provider } from '../../../../types';
import { useDocumentExpiry } from '../../hooks/useDocumentExpiry';

const STATUS_STYLES: Record<BankSubmissionStatus, { bg: string; text: string; label: string }> = {
  preparing:  { bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)', label: 'Preparing'  },
  submitted:  { bg: '#EFF6FF', text: '#1D4ED8', label: 'Submitted'  },
  in_review:  { bg: '#FFFBEB', text: '#92400E', label: 'In Review'  },
  sanctioned: { bg: '#F0FDF4', text: '#166534', label: 'Sanctioned' },
  disbursed:  { bg: '#DCFCE7', text: '#14532D', label: 'Disbursed'  },
  rejected:   { bg: '#FFF1F2', text: '#9F1239', label: 'Rejected'   },
};

interface Props {
  submission: BankSubmission;
  provider?: Provider;
  leadId: string;
  oppId: string;
}

export function BankSubmissionCard({ submission, provider, leadId, oppId }: Props) {
  const navigate = useNavigate();
  const st = STATUS_STYLES[submission.status];
  const { expiredCount, soonToExpireCount } = useDocumentExpiry(
    submission.documentStatus,
    submission.documentStatusLog,
  );

  const fmtDate = (ts: unknown) => {
    if (!ts) return null;
    if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
      return format((ts as { toDate: () => Date }).toDate(), 'dd MMM yy');
    }
    return null;
  };

  return (
    <button
      onClick={() => navigate(`/crm/leads/${leadId}/opportunities/${oppId}/submissions/${submission.id}`)}
      className="w-full text-left bg-(--glass-panel-bg) border border-(--shell-border-mid) rounded-xl p-4 hover:shadow-sm transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {provider?.name ?? submission.providerId.slice(0, 8)}
              </p>
              {submission.isPrimary && (
                <Star size={12} className="fill-current" style={{ color: '#C9A961' }} />
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {fmtDate(submission.createdAt) ? `Added ${fmtDate(submission.createdAt)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{ backgroundColor: st.bg, color: st.text }}>
            {st.label}
          </span>
          <ChevronRight size={14} className="text-(--text-muted) group-hover:text-(--text-muted) transition-colors" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-left">
        {submission.sanctionedAmount != null && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Sanctioned</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              ₹{submission.sanctionedAmount.toLocaleString('en-IN')}
            </p>
          </div>
        )}
        {submission.disbursedAmount != null && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Disbursed</p>
            <p className="text-sm font-medium" style={{ color: '#166534' }}>
              ₹{submission.disbursedAmount.toLocaleString('en-IN')}
            </p>
          </div>
        )}
        {submission.interestRate != null && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Rate</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{submission.interestRate}%</p>
          </div>
        )}
        {submission.submittedAt && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Submitted</p>
            <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{fmtDate(submission.submittedAt)}</p>
          </div>
        )}
        {submission.decisionAt && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Decision</p>
            <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{fmtDate(submission.decisionAt)}</p>
          </div>
        )}
      </div>

      {submission.rejectionReason && (
        <p className="mt-2 text-xs italic" style={{ color: '#9F1239' }}>
          "{submission.rejectionReason}"
        </p>
      )}

      {submission.documentStatus && Object.keys(submission.documentStatus).length > 0 && (() => {
        const statuses = Object.values(submission.documentStatus as Record<string, DocumentStatus>);
        const total     = statuses.length;
        const collected = statuses.filter((s) => s === 'collected').length;
        const submitted = statuses.filter((s) => s === 'submitted').length;
        const accepted  = statuses.filter((s) => s === 'accepted').length;
        const done      = collected + submitted + accepted;
        return (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {done} / {total} docs · {collected} collected · {submitted} submitted
            {accepted > 0 ? ` · ${accepted} accepted` : ''}
          </p>
        );
      })()}

      {expiredCount > 0 && (
        <p className="mt-1.5 text-xs font-semibold flex items-center gap-1" style={{ color: '#9F1239' }}>
          ⚠ {expiredCount} document{expiredCount > 1 ? 's' : ''} expired — refresh required
        </p>
      )}
      {soonToExpireCount > 0 && expiredCount === 0 && (
        <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: '#92400E' }}>
          ⏰ {soonToExpireCount} document{soonToExpireCount > 1 ? 's' : ''} expiring soon
        </p>
      )}
    </button>
  );
}
