import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QuickLogBar } from '../components/QuickLogBar';
import { ContactActions, PhoneLink } from '../components/ContactActions';
import { TransferModal } from '../opportunities/TransferModal';
import { formatSlaStatus } from '../../../lib/slaUtils';
import type { LeadWithOpportunity } from '../hooks/useMyLeads';
import type { LeadSource, OpportunityType } from '../../../types';

interface Props {
  item: LeadWithOpportunity;
  onRefresh?: () => void;
}

// ─── Source pill styles ───────────────────────────────────────────────────────
const SOURCE_STYLES: Record<LeadSource, { bg: string; text: string }> = {
  website:           { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  social_meta:       { bg: 'rgba(201,169,97,0.15)', text: '#C9A961' },
  instagram:         { bg: 'rgba(201,169,97,0.15)', text: '#C9A961' },
  facebook:          { bg: 'rgba(201,169,97,0.15)', text: '#C9A961' },
  offline_bulk:      { bg: 'var(--glass-panel-bg)', text: 'var(--text-muted)' },
  walkin:            { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  referral:          { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  sub_dsa:           { bg: 'var(--glass-panel-bg)', text: 'var(--text-muted)' },
  broker:            { bg: 'var(--glass-panel-bg)', text: 'var(--text-muted)' },
  employee_referral: { bg: 'rgba(201,169,97,0.15)', text: '#C9A961' },
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  website:           'Website',
  social_meta:       'Social',
  instagram:         'Instagram',
  facebook:          'Facebook',
  offline_bulk:      'Offline',
  walkin:            'Walk-in',
  referral:          'Referral',
  sub_dsa:           'Sub DSA',
  broker:            'Broker',
  employee_referral: 'Employee Ref',
};

// Condense "Suresh Kumar" → "Suresh K."
function shortName(displayName: string): string {
  const parts = displayName.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function MyQueueRow({ item, onRefresh }: Props) {
  const navigate  = useNavigate();

  const [logOpen,   setLogOpen]   = useState(false);
  // Phase P — timestamp of the last QuickLogBar submission for "Logged X min ago"
  const [lastLoggedAt, setLastLoggedAt] = useState<number | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const { lead, firstOpenOpportunity: opp } = item;
  const sourcePill = SOURCE_STYLES[lead.source] ?? SOURCE_STYLES.broker;
  const sla        = formatSlaStatus(lead.slaDeadline);

  return (
    <>
      {/* ─── Main row — wraps on mobile so nothing is cut off ─────────────── */}
      <div className="glass-panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5">
          {/* Name + tappable phone */}
          <div className="w-36 sm:w-32 shrink-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {shortName(lead.displayName)}
            </p>
            <p className="text-[11px] mt-0.5 truncate">
              <PhoneLink phone={lead.phone} mono={false} className="text-[11px]" />
            </p>
          </div>

          {/* Call / WhatsApp / Email — one-tap from the queue */}
          <div className="sm:w-28 shrink-0">
            <ContactActions phone={lead.phone} email={lead.email} name={lead.displayName} size="sm" />
          </div>

          {/* Product badge — hidden on small screens */}
          <div className="hidden md:block w-36 shrink-0">
            {opp?.product ? (
              <span
                className="inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full truncate max-w-full badge-glass-warning"
              >
                {opp.product}
              </span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
            )}
          </div>

          {/* Source — hidden on small screens */}
          <div className="hidden lg:block w-20 shrink-0">
            <span
              className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: sourcePill.bg, color: sourcePill.text }}
            >
              {SOURCE_LABELS[lead.source] ?? lead.source}
            </span>
          </div>

          {/* SLA — always visible (the urgency signal) */}
          <div className="w-auto sm:w-32 shrink-0">
            {sla ? (
              <span
                className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${sla.overdue ? 'badge-glass-danger' : sla.hoursLeft < 2 ? 'badge-glass-warning' : 'badge-glass-success'}`}
              >
                {sla.label}
              </span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No SLA</span>
            )}
          </div>

          {/* Stage — hidden on small screens */}
          <div className="hidden md:block flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {opp?.stage ?? '—'}
            </p>
          </div>

          {/* Quick actions — full-width row on mobile, inline on desktop */}
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:ml-auto">
            <button
              onClick={() => setLogOpen((v) => !v)}
              title="Log activity"
              className="text-xs px-3 py-2 sm:py-1.5 rounded-lg border hover:bg-(--shell-hover-soft) transition-colors font-medium flex-1 sm:flex-none"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
            >
              📝 Log
            </button>

            <button
              onClick={() => setTransferOpen(true)}
              disabled={!opp}
              title={opp ? 'Transfer to specialist' : 'No open opportunity'}
              className="text-xs px-3 py-2 sm:py-1.5 rounded-lg border hover:bg-(--shell-hover-soft) transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed flex-1 sm:flex-none"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
            >
              → Transfer
            </button>

            <button
              onClick={() => navigate('/crm/leads/' + lead.id)}
              title="Open lead detail"
              className="text-xs px-3 py-2 sm:py-1.5 rounded-lg font-semibold transition-opacity hover:opacity-80 flex-1 sm:flex-none"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              ↗ Open
            </button>
          </div>
        </div>

        {/* ─── Phase P: inline QuickLogBar (works on raw leads — writes the
             lead-level activity feed; replaces the old opportunity-only panel) */}
        {logOpen && (
          <div
            className="px-5 py-4"
            style={{ backgroundColor: 'var(--shell-hover-soft)', borderTop: '1px solid var(--shell-border)' }}
          >
            <QuickLogBar
              leadId={lead.id}
              opportunityId={opp?.id}
              markFirstContact={!(lead as { firstContactedAt?: unknown }).firstContactedAt}
              onLogged={() => {
                setLastLoggedAt(Date.now());
                setTimeout(() => { setLogOpen(false); onRefresh?.(); }, 1200);
              }}
            />
          </div>
        )}
        {!logOpen && lastLoggedAt != null && (
          <p className="px-5 py-2 text-[11px]" style={{ color: 'var(--status-success)', borderTop: '1px solid var(--shell-border)' }}>
            Logged {Math.max(1, Math.round((Date.now() - lastLoggedAt) / 60000))} min ago ✓
          </p>
        )}
      </div>

      {/* ─── Transfer modal ──────────────────────────────────────────────── */}
      {opp && (
        <TransferModal
          isOpen={transferOpen}
          onClose={() => setTransferOpen(false)}
          leadId={lead.id}
          opportunityId={opp.id}
          opportunityType={opp.opportunityType as OpportunityType}
        />
      )}
    </>
  );
}
