import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { logCallOutcome } from '../hooks/useMyLeads';
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
  broker:            'Broker',
  employee_referral: 'Employee Ref',
};

const CALL_OUTCOMES = [
  'Called - Interested',
  'Called - Not interested',
  'Called - No answer',
  'Called - Callback requested',
  'Called - Wrong number',
  'Left voicemail',
] as const;

// Condense "Suresh Kumar" → "Suresh K."
function shortName(displayName: string): string {
  const parts = displayName.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function MyQueueRow({ item, onRefresh }: Props) {
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [logOpen,   setLogOpen]   = useState(false);
  const [outcome,   setOutcome]   = useState<string>(CALL_OUTCOMES[0]);
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const { lead, firstOpenOpportunity: opp } = item;
  const sourcePill = SOURCE_STYLES[lead.source] ?? SOURCE_STYLES.broker;
  const sla        = formatSlaStatus(lead.slaDeadline);

  const handleLogSubmit = async () => {
    if (!user) return;
    if (!opp?.id) {
      alert('No open opportunity on this lead — cannot log call.');
      return;
    }
    setSaving(true);
    try {
      await logCallOutcome(lead.id, opp.id, outcome, notes, user.uid);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setLogOpen(false);
        setNotes('');
        setOutcome(CALL_OUTCOMES[0]);
        onRefresh?.();
      }, 1200);
    } catch {
      // Non-fatal — surface to user
      alert('Failed to save call log. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* ─── Main row ──────────────────────────────────────────────────────── */}
      <div className="glass-panel overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4">
          {/* Name */}
          <div className="w-32 shrink-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {shortName(lead.displayName)}
            </p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {lead.phone}
            </p>
          </div>

          {/* Product badge */}
          <div className="w-36 shrink-0">
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

          {/* Source */}
          <div className="w-20 shrink-0">
            <span
              className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: sourcePill.bg, color: sourcePill.text }}
            >
              {SOURCE_LABELS[lead.source] ?? lead.source}
            </span>
          </div>

          {/* SLA */}
          <div className="w-32 shrink-0">
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

          {/* Stage */}
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {opp?.stage ?? '—'}
            </p>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setLogOpen((v) => !v)}
              title="Log call"
              className="text-xs px-3 py-1.5 rounded-lg border hover:bg-(--shell-hover-soft) transition-colors font-medium"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
            >
              📞 Log call
            </button>

            <button
              onClick={() => setTransferOpen(true)}
              disabled={!opp}
              title={opp ? 'Transfer to specialist' : 'No open opportunity'}
              className="text-xs px-3 py-1.5 rounded-lg border hover:bg-(--shell-hover-soft) transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
            >
              → Transfer
            </button>

            <button
              onClick={() => navigate('/crm/leads/' + lead.id)}
              title="Open lead detail"
              className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              ↗ Open
            </button>
          </div>
        </div>

        {/* ─── Inline log panel ───────────────────────────────────────────── */}
        {logOpen && (
          <div
            className="px-5 py-4 space-y-3"
            style={{ backgroundColor: 'var(--shell-hover-soft)', borderTop: '1px solid var(--shell-border)' }}
          >
            {saved ? (
              <p className="text-sm font-semibold py-1" style={{ color: 'var(--status-success)' }}>
                Saved ✓
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                      Outcome
                    </p>
                    <select
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      className="glass-inp text-sm"
                    >
                      {CALL_OUTCOMES.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 min-w-48">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                      Notes (optional)
                    </p>
                    <input
                      type="text"
                      placeholder="Notes (optional)…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="glass-inp w-full text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleLogSubmit}
                      disabled={saving}
                      className="text-sm px-4 py-1.5 font-semibold rounded-lg transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setLogOpen(false); setNotes(''); setOutcome(CALL_OUTCOMES[0]); }}
                      className="text-sm px-3 py-1.5 border rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
                      style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {outcome === 'Called - Not interested' && (
                  <p className="text-xs px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'rgba(251,146,60,0.10)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}>
                    Consider marking this opportunity as lost.
                  </p>
                )}

                {!opp && (
                  <p className="text-xs px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
                    No open opportunity on this lead — log will not be saved.
                  </p>
                )}
              </>
            )}
          </div>
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
