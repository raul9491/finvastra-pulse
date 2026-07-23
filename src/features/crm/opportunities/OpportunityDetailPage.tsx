import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, ChevronRight, TrendingDown, MessageSquare } from 'lucide-react';
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { PresenceChips } from '../components/PresenceChips';
import { FieldHistory } from '../components/FieldHistory';
import { useLead } from '../hooks/useLeads';
import { useOpportunity, useActivities, useOpportunityTypes, updateOpportunityStage, markOpportunityLost, addNote } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { BankSubmissionsSection } from './loans/BankSubmissionsSection';
import { BankEligibilityCard } from './BankEligibilityCard';
import { WealthInvestmentsSection } from './wealth/WealthInvestmentsSection';
import { InsurancePoliciesSection } from './insurance/InsurancePoliciesSection';
import { CrmDocumentVault } from './CrmDocumentVault';
import type { LostReason, LostDetails } from '../../../types';
import { LOST_REASON_LABELS } from '../../../types';
import { StageAdvanceModal } from './StageAdvanceModal';
import { StageDataHistory } from './StageDataHistory';
import { TYPE_COLORS, TYPE_ICONS, ACTIVITY_ICONS } from './stageForms';
import type { AnyStageData, OpportunityWithStageData, DisbursedData } from './stageForms';

// ─── Lost Reason Modal ────────────────────────────────────────────────────────

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay">
      <div className="glass-modal-panel p-6 w-full max-w-md mx-4 space-y-4">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Mark as Lost — Capture Reason
        </h3>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Reason *
          </label>
          <select value={reason} onChange={(e) => setReason(e.target.value as LostReason | '')}
            className="glass-inp w-full text-sm">
            <option value="">Select reason…</option>
            {(Object.entries(LOST_REASON_LABELS) as [LostReason, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        {isCompetitorReason && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Competitor Name
              </label>
              <input type="text" value={competitorName} onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g. Bajaj Finserv" className="glass-inp w-full text-sm" />
            </div>
            {reason === 'lower_rate_competitor' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Competitor Rate (%)
                </label>
                <input type="number" step="0.01" value={competitorRate} onChange={(e) => setCompetitorRate(e.target.value)}
                  placeholder="8.5" className="glass-inp w-full text-sm" />
              </div>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Notes (optional)
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} className="glass-inp w-full text-sm resize-none" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm border rounded-xl hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!reason || loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-40"
            style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}>
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
                  backgroundColor: done ? '#C9A961' : active ? '#C9A961' : 'var(--shell-hover-hard)',
                  color: done ? '#0B1538' : active ? '#0B1538' : 'var(--text-dim)',
                }}>
                {done ? '✓' : i + 1}
              </div>
              <p className="text-[9px] font-medium mt-1 text-center leading-tight"
                style={{ color: active ? '#C9A961' : done ? 'var(--text-muted)' : 'var(--text-dim)' }}>
                {stage}
              </p>
            </div>
            {i < stages.length - 1 && (
              <div className="w-6 h-0.5 mb-5 shrink-0"
                style={{ backgroundColor: done ? '#C9A961' : 'var(--shell-hover-hard)' }} />
            )}
          </div>
        );
      })}
      {isLost && (
        <div className="ml-3 self-start mt-1 badge-glass-danger px-2.5 py-0.5">Lost</div>
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

  const [noteText, setNoteText]         = useState('');
  const [savingNote, setSavingNote]     = useState(false);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageSaving, setStageSaving]   = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const isOwner = user?.uid === opportunity?.ownerId;
  const canAct  = isAdmin || isOwner;

  const typeConfig = useMemo(
    () => types.find((t) => t.name === opportunity?.product),
    [types, opportunity?.product],
  );
  const stages     = typeConfig?.stages ?? [];
  const currentIdx = opportunity ? stages.indexOf(opportunity.stage) : -1;
  const hasNext    = currentIdx >= 0 && currentIdx < stages.length - 1;
  const isTerminal = opportunity?.status === 'won' || opportunity?.status === 'lost';

  const opp = opportunity as OpportunityWithStageData | null;

  const authorName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  // ── Stage advance with data capture ──────────────────────────────────────────
  const handleStageAdvanceConfirm = async (formData: AnyStageData) => {
    if (!opp || !user || !canAct || !hasNext || !leadId || !oppId) return;
    setStageSaving(true);
    try {
      const next     = stages[currentIdx + 1];
      const stageKey = next.toLowerCase().trim();
      const isLast   = currentIdx + 1 === stages.length - 1;

      // 1. Save stage-specific data on the opportunity doc
      await updateDoc(doc(db, 'leads', leadId, 'opportunities', oppId), {
        stageData: { ...(opp.stageData ?? {}), [stageKey]: formData },
        updatedAt: serverTimestamp(),
      });

      // 1.5 If disbursed — push reference numbers onto the linked commission_record
      // so MIS can see Loan No, App No, etc. alongside the commission entry.
      if (stageKey === 'disbursed') {
        try {
          const d = formData as unknown as DisbursedData;
          const recSnap = await getDocs(
            query(collection(db, 'commission_records'), where('opportunityId', '==', oppId))
          );
          for (const recDoc of recSnap.docs) {
            await updateDoc(recDoc.ref, {
              loanNo:              d.loanNo             || null,
              applicationNo:       d.applicationNo      || null,
              disbursedAmount:     d.disbursedAmount ? Number(d.disbursedAmount) : null,
              disbursalDate:       d.disbursalDate       || null,
              dsaCode:             d.dsaCode             || null,
              dsaName:             d.dsaName             || null,
              cityState:           d.cityState           || null,
              customerCompanyName: d.customerCompanyName || null,
              updatedAt:           serverTimestamp(),
            });
          }
        } catch (_) {
          // Non-fatal — stage advance still proceeds even if record enrichment fails
        }
      }

      // 2. Advance the stage (handles activity log + won status)
      await updateOpportunityStage(leadId, oppId, next, opp.stage, user.uid, isLast);
      setStageModalOpen(false);
    } finally {
      setStageSaving(false);
    }
  };

  const handleMarkLost = () => {
    if (!opp || !user || !canAct) return;
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
        <div className="h-5 rounded w-32" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-8 rounded w-48" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-40 rounded-2xl" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
      </div>
    );
  }

  const col    = TYPE_COLORS[opportunity.opportunityType];
  const isLost = opportunity.status === 'lost';
  const isWon  = opportunity.status === 'won';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <button onClick={() => navigate(`/crm/leads/${leadId}`)}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> {lead?.displayName ?? 'Customer'}
      </button>

      {/* Header card */}
      <div className="glass-panel p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: col.bg, color: col.text }}>
              {TYPE_ICONS[opportunity.opportunityType]}
            </div>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{opportunity.product}</h2>
              <p className="text-sm capitalize" style={{ color: 'var(--text-muted)' }}>{opportunity.opportunityType}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Phase P — who else is on this opportunity right now */}
            <PresenceChips pageKey={oppId ? `opportunity:${oppId}` : null} />
            <span className={isWon ? 'badge-glass-success' : isLost ? 'badge-glass-danger' : 'badge-glass-warning'}>
              {opportunity.status}
            </span>
            {/* Phase P — stage change history (admin/manager) */}
            {leadId && oppId && (
              <FieldHistory parentPath={['leads', leadId, 'opportunities', oppId]} field="stage" label="Stage" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Deal Size {leadId && oppId && <FieldHistory parentPath={['leads', leadId, 'opportunities', oppId]} field="dealSize" label="Deal Size" />}</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>₹{opportunity.dealSize.toLocaleString('en-IN')}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>RM</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{authorName(opportunity.ownerId)}</p>
          </div>
          {opportunity.connectorName && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Sourced by Connector</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {opportunity.connectorName}
                {opportunity.connectorCode && <span style={{ color: 'var(--text-muted)' }}> · {opportunity.connectorCode}</span>}
              </p>
            </div>
          )}
          {opportunity.expectedCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Expected Close</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(opportunity.expectedCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
          {opportunity.actualCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Closed On</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(opportunity.actualCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stage stepper + controls */}
      <div className="glass-panel p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
          Pipeline Stage
        </h3>
        {stages.length > 0 ? (
          <StageStepper stages={stages} current={opportunity.stage} isLost={isLost} />
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading stage config…</p>
        )}

        {canAct && !isTerminal && (
          <div className="flex gap-3 mt-5">
            {hasNext && (
              <button onClick={() => setStageModalOpen(true)} disabled={stageSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                <ChevronRight size={15} />
                Move to {stages[currentIdx + 1]}
              </button>
            )}
            <button onClick={handleMarkLost} disabled={stageSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 btn-glass-danger">
              <TrendingDown size={15} /> Mark as Lost
            </button>
          </div>
        )}
      </div>

      {/* Stage data history accordion */}
      <StageDataHistory
        stages={stages}
        stageData={opp?.stageData}
      />

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

      {/* Stage advance modal */}
      {stageModalOpen && hasNext && opp && (
        <StageAdvanceModal
          targetStage={stages[currentIdx + 1]}
          opportunityType={opportunity.opportunityType}
          product={opportunity.product}
          existingStageData={(opp.stageData ?? {}) as Record<string, AnyStageData>}
          onConfirm={handleStageAdvanceConfirm}
          onCancel={() => setStageModalOpen(false)}
          saving={stageSaving}
        />
      )}

      {/* Lost Reason Modal */}
      {lostModalOpen && (
        <LostReasonModal
          onConfirm={async (details) => {
            if (!user) return;
            setStageSaving(true);
            try {
              await markOpportunityLost(leadId!, oppId!, user.uid, details);
              // If no open opportunities remain on this lead, clear its SLA so it drops
              // out of "overdue" counts instantly (telecaller closed/lost the deal).
              try {
                const openSnap = await getDocs(query(
                  collection(db, 'leads', leadId!, 'opportunities'),
                  where('status', '==', 'open'),
                ));
                if (openSnap.empty) {
                  await updateDoc(doc(db, 'leads', leadId!), { slaDeadline: null, updatedAt: serverTimestamp() });
                }
              } catch { /* non-fatal — opportunity is already marked lost */ }
              setLostModalOpen(false);
            } finally {
              setStageSaving(false);
            }
          }}
          onCancel={() => setLostModalOpen(false)}
          loading={stageSaving}
        />
      )}

      {/* Document vault */}
      <CrmDocumentVault opportunityId={oppId!} leadId={leadId!} canWrite={canAct} />

      {/* Activity timeline */}
      <div className="glass-panel p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>Activity</h3>
        <div className="flex gap-2 mb-5">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…" rows={2}
            className="glass-inp flex-1 text-sm resize-none" />
          <button onClick={handleAddNote} disabled={!noteText.trim() || savingNote}
            className="shrink-0 self-end flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            <MessageSquare size={14} />
            {savingNote ? '…' : 'Add'}
          </button>
        </div>
        <div>
          {activities.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No activity yet.</p>
          ) : activities.map((a, idx) => (
            <div key={a.id} className="flex gap-3 py-3"
              style={{ borderBottom: idx < activities.length - 1 ? '1px solid var(--shell-border)' : 'none' }}>
              <span className="text-base shrink-0 mt-0.5">{ACTIVITY_ICONS[a.type] ?? '📌'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{a.content}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
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
