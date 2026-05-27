import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, ChevronRight, TrendingDown, MessageSquare, Briefcase, TrendingUp, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useLead } from '../hooks/useLeads';
import { useOpportunity, useActivities, useOpportunityTypes, updateOpportunityStage, markOpportunityLost, addNote } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { BankSubmissionsSection } from './loans/BankSubmissionsSection';
import { BankEligibilityCard } from './BankEligibilityCard';
import { WealthInvestmentsSection } from './wealth/WealthInvestmentsSection';
import { InsurancePoliciesSection } from './insurance/InsurancePoliciesSection';
import type { OpportunityType, ActivityType, LostReason, LostDetails } from '../../../types';
import { LOST_REASON_LABELS } from '../../../types';

const TYPE_ICONS: Record<OpportunityType, React.ReactNode> = {
  loan:      <Briefcase size={16} />,
  wealth:    <TrendingUp size={16} />,
  insurance: <ShieldCheck size={16} />,
};
const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: '#EFF6FF', text: '#1D4ED8' },
  wealth:    { bg: '#F0FDF4', text: '#166534' },
  insurance: { bg: '#FFF7ED', text: '#9A3412' },
};
const ACTIVITY_ICONS: Record<ActivityType, string> = {
  note: '📝', status_change: '🔄', ownership_change: '🔁', commission_calculated: '💰', call: '📞', email: '✉️', whatsapp: '💬', meeting: '🤝',
};

// ─── Lost Reason Modal ───────────────────────────────────────────────────────
function LostReasonModal({ onConfirm, onCancel, loading }: {
  onConfirm: (details: Omit<LostDetails, 'capturedAt' | 'capturedBy'>) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [competitorName, setCompetitorName] = useState('');
  const [competitorRate, setCompetitorRate] = useState('');
  const [notes, setNotes] = useState('');

  const isCompetitorReason =
    reason === 'lower_rate_competitor' ||
    reason === 'faster_approval_competitor' ||
    reason === 'better_terms_competitor';

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm({
      reason: reason as LostReason,
      ...(competitorName ? { competitorName } : {}),
      ...(competitorRate ? { competitorRate: parseFloat(competitorRate) } : {}),
      ...(notes ? { notes } : {}),
    });
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 transition-colors bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 space-y-4 shadow-xl">
        <h3 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>
          Mark as Lost — Capture Reason
        </h3>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
            Reason *
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as LostReason | '')}
            className={inputClass}
          >
            <option value="">Select reason…</option>
            {(Object.entries(LOST_REASON_LABELS) as [LostReason, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {isCompetitorReason && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
                Competitor Name
              </label>
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g. Bajaj Finserv"
                className={inputClass}
              />
            </div>
            {reason === 'lower_rate_competitor' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
                  Competitor Rate (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={competitorRate}
                  onChange={(e) => setCompetitorRate(e.target.value)}
                  placeholder="8.5"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl hover:bg-slate-50"
            style={{ color: '#2A2A2A' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason || loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-40"
            style={{ backgroundColor: '#EF4444', color: '#FFFFFF' }}
          >
            {loading ? '…' : 'Confirm Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Stepper ────────────────────────────────────────────────────────────
function StageStepper({ stages, current, isLost }: { stages: string[]; current: string; isLost: boolean }) {
  const currentIdx = stages.indexOf(current);

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1 pt-1">
      {stages.map((stage, i) => {
        const done   = !isLost && i < currentIdx;
        const active = !isLost && i === currentIdx;
        return (
          <div key={stage} className="flex items-center min-w-0">
            <div className="flex flex-col items-center min-w-15">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  backgroundColor: done ? '#0B1538' : active ? '#C9A961' : '#E2E8F0',
                  color: done ? '#C9A961' : active ? '#0B1538' : '#94A3B8',
                }}>
                {done ? '✓' : i + 1}
              </div>
              <p className="text-[9px] font-medium mt-1 text-center leading-tight"
                style={{ color: active ? '#0B1538' : done ? '#475569' : '#94A3B8' }}>
                {stage}
              </p>
            </div>
            {i < stages.length - 1 && (
              <div className="w-6 h-0.5 mb-5 shrink-0"
                style={{ backgroundColor: done ? '#0B1538' : '#E2E8F0' }} />
            )}
          </div>
        );
      })}
      {isLost && (
        <div className="ml-3 self-start mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600">
          Lost
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function OpportunityDetailPage() {
  const { leadId, oppId } = useParams<{ leadId: string; oppId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lead } = useLead(leadId ?? null);
  const { opportunity, loading } = useOpportunity(leadId ?? null, oppId ?? null);
  const { activities } = useActivities(leadId ?? null, oppId ?? null);
  const { types } = useOpportunityTypes();
  const { employees } = useAllEmployees();

  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [stageLoading, setStageLoading] = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const isOwner = user?.uid === opportunity?.ownerId;
  const canAct  = isAdmin || isOwner;

  const typeConfig = useMemo(
    () => types.find((t) => t.name === opportunity?.product),
    [types, opportunity?.product],
  );
  const stages = typeConfig?.stages ?? [];
  const currentIdx  = opportunity ? stages.indexOf(opportunity.stage) : -1;
  const hasNext     = currentIdx >= 0 && currentIdx < stages.length - 1;
  const isTerminal  = opportunity?.status === 'won' || opportunity?.status === 'lost';

  const authorName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const handleNextStage = async () => {
    if (!opportunity || !user || !canAct || !hasNext) return;
    setStageLoading(true);
    try {
      const next = stages[currentIdx + 1];
      const isLast = currentIdx + 1 === stages.length - 1;
      await updateOpportunityStage(leadId!, oppId!, next, opportunity.stage, user.uid, isLast);
    } finally {
      setStageLoading(false);
    }
  };

  const handleMarkLost = () => {
    if (!opportunity || !user || !canAct) return;
    setLostModalOpen(true);
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !user || !leadId || !oppId) return;
    setSavingNote(true);
    try {
      await addNote(leadId, oppId, noteText, user.uid);
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  };

  if (loading || !opportunity) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-5 bg-slate-200 rounded w-32" />
        <div className="h-8 bg-slate-200 rounded w-48" />
        <div className="h-40 bg-slate-100 rounded-2xl" />
      </div>
    );
  }

  const col = TYPE_COLORS[opportunity.opportunityType];
  const isLost = opportunity.status === 'lost';
  const isWon  = opportunity.status === 'won';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <button onClick={() => navigate(`/crm/leads/${leadId}`)}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: '#8B8B85' }}>
        <ArrowLeft size={15} /> {lead?.displayName ?? 'Customer'}
      </button>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: col.bg, color: col.text }}>
              {TYPE_ICONS[opportunity.opportunityType]}
            </div>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: '#0A0A0A' }}>{opportunity.product}</h2>
              <p className="text-sm capitalize" style={{ color: '#8B8B85' }}>{opportunity.opportunityType}</p>
            </div>
          </div>
          <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
            isWon  ? 'bg-emerald-50 text-emerald-700' :
            isLost ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
          }`}>
            {opportunity.status}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Deal Size</p>
            <p className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>₹{opportunity.dealSize.toLocaleString('en-IN')}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>RM</p>
            <p className="text-sm" style={{ color: '#0A0A0A' }}>{authorName(opportunity.ownerId)}</p>
          </div>
          {opportunity.expectedCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Expected Close</p>
              <p className="text-sm" style={{ color: '#0A0A0A' }}>
                {format(new Date(opportunity.expectedCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
          {opportunity.actualCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Closed On</p>
              <p className="text-sm" style={{ color: '#0A0A0A' }}>
                {format(new Date(opportunity.actualCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stage stepper + controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>Pipeline Stage</h3>
        {stages.length > 0 ? (
          <StageStepper stages={stages} current={opportunity.stage} isLost={isLost} />
        ) : (
          <p className="text-sm" style={{ color: '#8B8B85' }}>Loading stage config…</p>
        )}

        {canAct && !isTerminal && (
          <div className="flex gap-3 mt-5">
            {hasNext && (
              <button onClick={handleNextStage} disabled={stageLoading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                <ChevronRight size={15} />
                Move to {stages[currentIdx + 1]}
              </button>
            )}
            <button onClick={handleMarkLost} disabled={stageLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              <TrendingDown size={15} /> Mark as Lost
            </button>
          </div>
        )}
      </div>

      {/* Sub-collection section — type-specific */}
      {opportunity.opportunityType === 'loan' ? (
        <>
          <BankEligibilityCard
            opportunity={opportunity}
            lead={{ monthlyIncome: lead?.monthlyIncome, existingEmis: lead?.existingEmis }}
            foirPct={null}
          />
          <BankSubmissionsSection leadId={leadId!} oppId={oppId!} oppOwnerId={opportunity.ownerId} opportunityProduct={opportunity.product} />
        </>
      ) : opportunity.opportunityType === 'wealth' ? (
        <WealthInvestmentsSection leadId={leadId!} oppId={oppId!} canWrite={canAct} />
      ) : (
        <InsurancePoliciesSection leadId={leadId!} oppId={oppId!} canWrite={canAct} />
      )}

      {/* Lost Reason Modal */}
      {lostModalOpen && (
        <LostReasonModal
          onConfirm={async (details) => {
            if (!user) return;
            setStageLoading(true);
            try {
              await markOpportunityLost(leadId!, oppId!, user.uid, details);
              setLostModalOpen(false);
            } finally {
              setStageLoading(false);
            }
          }}
          onCancel={() => setLostModalOpen(false)}
          loading={stageLoading}
        />
      )}

      {/* Activity timeline */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>Activity</h3>

        <div className="flex gap-2 mb-5">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…" rows={2}
            className="flex-1 text-sm px-3.5 py-2.5 border border-slate-200 rounded-lg outline-none resize-none focus:ring-2 transition-colors" />
          <button onClick={handleAddNote} disabled={!noteText.trim() || savingNote}
            className="shrink-0 self-end flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            <MessageSquare size={14} />
            {savingNote ? '…' : 'Add'}
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {activities.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: '#8B8B85' }}>No activity yet.</p>
          ) : activities.map((a) => (
            <div key={a.id} className="flex gap-3 py-3">
              <span className="text-base shrink-0 mt-0.5">{ACTIVITY_ICONS[a.type] ?? '📌'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm" style={{ color: '#2A2A2A' }}>{a.content}</p>
                <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                  {authorName(a.by)}
                  {a.at?.toDate ? ` · ${format(a.at.toDate(), 'dd MMM yyyy, HH:mm')}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
