import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Plus, TrendingUp, Briefcase, ShieldCheck, ChevronRight, Calendar } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useLead } from '../hooks/useLeads';
import { formatSlaStatus } from '../../../lib/slaUtils';
import { useOpportunities, useOpportunityTypes } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { getMaskedPan } from './panUtils';
import { auth, db } from '../../../lib/firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { FOIRCalculator } from './FOIRCalculator';
import { QuickContactBar } from './QuickContactBar';
import type { Opportunity, OpportunityType, OpportunityStatus, LeadStatus } from '../../../types';

// ─── Opportunity type icons ───────────────────────────────────────────────────
const TYPE_ICONS: Record<OpportunityType, React.ReactNode> = {
  loan:      <Briefcase size={18} />,
  wealth:    <TrendingUp size={18} />,
  insurance: <ShieldCheck size={18} />,
};

const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  wealth:    { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  insurance: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
};

const STATUS_STYLES: Record<OpportunityStatus, string> = {
  open: 'badge-glass-warning',
  won:  'badge-glass-success',
  lost: 'badge-glass-danger',
};

const SOURCE_LABELS: Record<string, string> = {
  website: 'Website', instagram: 'Instagram', facebook: 'Facebook',
  walkin: 'Walk-in', referral: 'Referral', broker: 'Broker',
};

// ─── Mini stage progress dots ─────────────────────────────────────────────────
function MiniStageDots({ stages, current, isLost, isWon }: {
  stages: string[]; current: string; isLost: boolean; isWon: boolean;
}) {
  if (stages.length === 0) return null;
  const idx = stages.indexOf(current);

  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => {
        const done   = isWon || i < idx;
        const active = !isLost && !isWon && i === idx;
        return (
          <div key={s} title={s} className="flex items-center gap-0.5">
            <div
              className="w-2 h-2 rounded-full shrink-0 transition-colors"
              style={{
                backgroundColor: done
                  ? '#C9A961'
                  : active
                  ? '#C9A961'
                  : isLost
                  ? 'rgba(248,113,113,0.30)'
                  : 'rgba(255,255,255,0.12)',
                outline: active ? '1.5px solid #C9A961' : 'none',
                outlineOffset: '1px',
              }}
            />
            {i < stages.length - 1 && (
              <div className="w-2 h-px shrink-0"
                style={{ backgroundColor: done ? 'rgba(201,169,97,0.40)' : 'rgba(255,255,255,0.08)' }} />
            )}
          </div>
        );
      })}
      <span className="ml-1.5 text-[10px] font-medium truncate max-w-30"
        style={{ color: isLost ? '#f87171' : isWon ? '#34d399' : 'var(--text-muted)' }}>
        {isLost ? 'Lost' : isWon ? 'Won' : current}
      </span>
    </div>
  );
}

// ─── Opportunity card ─────────────────────────────────────────────────────────
function OpportunityCard({ opp, leadId, ownerName, stages }: {
  opp: Opportunity; leadId: string; ownerName: string; stages: string[];
}) {
  const navigate = useNavigate();
  const col = TYPE_COLORS[opp.opportunityType];
  const isLost = opp.status === 'lost';
  const isWon  = opp.status === 'won';

  return (
    <button
      onClick={() => navigate(`/crm/leads/${leadId}/opportunities/${opp.id}`)}
      className="w-full text-left glass-panel p-5 hover:shadow-md transition-all group"
    >
      {/* Row 1: type icon + product name + status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: col.bg, color: col.text }}>
            {TYPE_ICONS[opp.opportunityType]}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{opp.product}</p>
            <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{opp.opportunityType}</p>
          </div>
        </div>
        <span className={STATUS_STYLES[opp.status]}>
          {opp.status}
        </span>
      </div>

      {/* Row 2: stage progress dots */}
      <div className="mb-3">
        <MiniStageDots stages={stages} current={opp.stage} isLost={isLost} isWon={isWon} />
      </div>

      {/* Row 3: deal size, RM, expected close */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>Deal Size</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            ₹{opp.dealSize.toLocaleString('en-IN')}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>RM</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{ownerName}</p>
        </div>
        {opp.expectedCloseDate && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>Close By</p>
            <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <Calendar size={11} />
              {format(new Date(opp.expectedCloseDate), 'dd MMM yyyy')}
            </p>
          </div>
        )}
        <ChevronRight size={16} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-80 transition-opacity shrink-0" />
      </div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function LeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { profile, user } = useAuth();
  const { lead, loading: leadLoading } = useLead(leadId ?? null);
  const { opportunities, loading: oppsLoading } = useOpportunities(leadId ?? null);
  const { employees } = useAllEmployees();
  const { types } = useOpportunityTypes();

  const justCreated = (state as { justCreated?: boolean } | null)?.justCreated;

  const isAdmin = profile?.role === 'admin';
  const isPrimaryOwner = user?.uid === lead?.primaryOwnerId;

  // ─── Lead view audit log ──────────────────────────────────────────────────────
  // Fires once when the lead finishes loading. useRef guard prevents double-fire
  // from React strict mode. Stored in /lead_view_logs — admin-only read.
  const loggedRef = useRef(false);
  useEffect(() => {
    if (!lead || !user?.uid || loggedRef.current) return;
    loggedRef.current = true;
    addDoc(collection(db, 'lead_view_logs'), {
      viewedBy:     user.uid,
      viewedByName: profile?.displayName ?? '',
      leadId:       lead.id,
      leadName:     lead.displayName,
      viewedAt:     serverTimestamp(),
    }).catch(() => {});
  }, [lead?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Lead disposition (telecaller status) ──────────────────────────────────────
  const [savingStatus, setSavingStatus] = useState(false);
  const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
    new:            'New',
    interested:     'Interested',
    callback:       'Callback later',
    not_interested: 'Not interested',
    no_response:    'No response / not reachable',
    wrong_number:   'Wrong number',
    converted:      'Converted',
  };
  const TERMINAL_STATUSES = new Set<LeadStatus>(['not_interested', 'no_response', 'wrong_number']);

  const handleDisposition = async (status: LeadStatus) => {
    if (!leadId || !user) return;
    setSavingStatus(true);
    try {
      await updateDoc(doc(db, 'leads', leadId), {
        leadStatus:   status,
        leadStatusAt: serverTimestamp(),
        leadStatusBy: user.uid,
        updatedAt:    serverTimestamp(),
        // Closing dispositions clear the SLA so the lead drops out of "overdue" instantly.
        ...(TERMINAL_STATUSES.has(status) ? { slaDeadline: null } : {}),
      });
    } finally {
      setSavingStatus(false);
    }
  };

  // ─── Callback scheduling (shown when status === 'callback') ─────────────────────
  const [callbackInput, setCallbackInput] = useState('');
  const [savingCallback, setSavingCallback] = useState(false);
  useEffect(() => {
    if (!lead?.callbackAt) return;
    const d = new Date(lead.callbackAt);
    setCallbackInput(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }, [lead?.callbackAt]);

  const handleSaveCallback = async () => {
    if (!leadId || !callbackInput) return;
    setSavingCallback(true);
    try {
      await updateDoc(doc(db, 'leads', leadId), {
        callbackAt: new Date(callbackInput).toISOString(),
        callbackReminderSent: false,        // re-arm the reminder
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingCallback(false);
    }
  };

  // ─── PAN reveal state ─────────────────────────────────────────────────────────
  const [revealedPan, setRevealedPan]         = useState<string | null>(null);
  const [revealingPan, setRevealingPan]       = useState(false);
  const [revealError, setRevealError]         = useState('');
  const [revealCountdown, setRevealCountdown] = useState(30);
  const canRevealPan = isAdmin || isPrimaryOwner;

  const handleRevealPan = async () => {
    setRevealingPan(true);
    setRevealError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/leads/${leadId}/pan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { pan?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setRevealedPan(data.pan ?? null);
      let t = 30;
      setRevealCountdown(t);
      const interval = setInterval(() => {
        t--;
        setRevealCountdown(t);
        if (t <= 0) { clearInterval(interval); setRevealedPan(null); }
      }, 1000);
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : 'Failed to reveal PAN');
    } finally {
      setRevealingPan(false);
    }
  };

  const ownerName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const openOpps  = opportunities.filter((o) => o.status === 'open');
  const closedOpps = opportunities.filter((o) => o.status !== 'open');

  const totalOpen = openOpps.reduce((s, o) => s + o.dealSize, 0);
  const totalWon  = closedOpps.filter((o) => o.status === 'won').reduce((s, o) => s + o.dealSize, 0);

  if (leadLoading) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-5 rounded w-28" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-8 rounded w-56" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-40 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-20">
        <p style={{ color: 'var(--text-muted)' }}>Customer not found.</p>
        <button onClick={() => navigate('/crm/leads')} className="mt-3 text-sm underline" style={{ color: '#C9A961' }}>
          Back to Customers
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/crm/leads')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Customers
      </button>

      {/* Quick contact bar — shown to the lead generator who owns this lead */}
      {profile?.crmRole === 'lead_generator' && user?.uid === lead.primaryOwnerId && (
        <QuickContactBar
          lead={lead}
          oppId={
            opportunities.find(
              (o) => o.opportunityType === 'loan' && o.status === 'open',
            )?.id ?? null
          }
        />
      )}

      {/* Just-created banner */}
      {justCreated && (
        <div className="rounded-xl px-5 py-3 text-sm font-medium flex items-center justify-between"
          style={{ backgroundColor: 'rgba(201,169,97,0.10)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.30)' }}>
          <span>Customer saved. Now add the first opportunity.</span>
          <button onClick={() => navigate(`/crm/leads/${leadId}/opportunities/new`)}
            className="font-bold underline ml-4">
            Add Opportunity →
          </button>
        </div>
      )}

      {/* Customer card */}
      <div className="glass-panel p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
              {lead.displayName}
            </h2>
            <p className="text-sm mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
              <span>{SOURCE_LABELS[lead.source] ?? lead.source} · Primary RM: {ownerName(lead.primaryOwnerId)}</span>
              {isAdmin && lead.primaryOwnerId && (
                <Link
                  to={`/hrms/employees/${lead.primaryOwnerId}`}
                  className="inline-flex items-center gap-0.5 text-xs font-medium transition-opacity hover:opacity-70"
                  style={{ color: '#C9A961' }}
                >
                  View HR Profile →
                </Link>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-glass-success">
              Consent ✓
            </span>
            {/* SLA indicator */}
            {(() => {
              const sla = formatSlaStatus(lead.slaDeadline);
              if (!sla) return null;
              return (
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${sla.overdue ? 'badge-glass-danger' : sla.hoursLeft < 4 ? 'badge-glass-warning' : 'badge-glass-info'}`}>
                  SLA: {sla.label}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Lead disposition — telecaller marks the call outcome (works even with no opportunity) */}
        {(isAdmin || isPrimaryOwner) && (
          <div className="flex flex-wrap items-center gap-2 mb-5 pb-5" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Status</span>
            <select
              value={lead.leadStatus ?? 'new'}
              disabled={savingStatus}
              onChange={(e) => handleDisposition(e.target.value as LeadStatus)}
              className="glass-inp text-sm"
              style={{ maxWidth: 240, borderColor: lead.leadStatus && TERMINAL_STATUSES.has(lead.leadStatus) ? 'rgba(248,113,113,0.5)' : undefined }}
            >
              <option value="new">New</option>
              <option value="interested">Interested</option>
              <option value="callback">Callback later</option>
              <option value="not_interested">Not interested</option>
              <option value="no_response">No response / not reachable</option>
              <option value="wrong_number">Wrong number</option>
            </select>
            {savingStatus && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Saving…</span>}
            {!savingStatus && lead.leadStatus && lead.leadStatus !== 'new' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                style={{
                  backgroundColor: TERMINAL_STATUSES.has(lead.leadStatus) ? 'rgba(248,113,113,0.12)' : 'rgba(201,169,97,0.12)',
                  color: TERMINAL_STATUSES.has(lead.leadStatus) ? '#f87171' : '#C9A961',
                }}>
                {LEAD_STATUS_LABELS[lead.leadStatus]}{TERMINAL_STATUSES.has(lead.leadStatus) ? ' · closed, SLA cleared' : ''}
              </span>
            )}
            {lead.leadStatus === 'callback' && (
              <div className="flex flex-wrap items-center gap-2 w-full mt-1">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Call back at</span>
                <input type="datetime-local" value={callbackInput} onChange={(e) => setCallbackInput(e.target.value)} className="glass-inp text-sm" />
                <button onClick={handleSaveCallback} disabled={savingCallback || !callbackInput}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  {savingCallback ? '…' : (lead.callbackAt ? 'Update reminder' : 'Set reminder')}
                </button>
                {lead.callbackAt && (
                  <span className="text-xs font-semibold" style={{ color: '#C9A961' }}>
                    ⏰ {new Date(lead.callbackAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Phone</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{lead.phone}</p>
          </div>
          {lead.email && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Email</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{lead.email}</p>
            </div>
          )}
          {getMaskedPan(lead) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>PAN</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                  {revealedPan ?? getMaskedPan(lead)}
                </p>
                {canRevealPan && !revealedPan && (
                  <button onClick={handleRevealPan} disabled={revealingPan}
                    className="text-xs px-2 py-0.5 rounded border hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>
                    {revealingPan ? '…' : 'Reveal'}
                  </button>
                )}
                {revealedPan && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>visible for {revealCountdown}s</span>
                )}
              </div>
              {revealError && <p className="text-xs text-red-400 mt-0.5">{revealError}</p>}
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Added</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {lead.createdAt?.toDate ? format(lead.createdAt.toDate(), 'dd MMM yyyy') : '—'}
            </p>
          </div>
          {(lead.tags ?? []).length > 0 && (
            <div className="col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Tags</p>
              <div className="flex flex-wrap gap-1">
                {lead.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded text-xs bg-white/8" style={{ color: 'var(--text-muted)' }}>{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Stats strip */}
      {opportunities.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Open Opportunities', value: openOpps.length.toString(), sub: `₹${totalOpen.toLocaleString('en-IN')} total` },
            { label: 'Won',   value: closedOpps.filter(o => o.status === 'won').length.toString(), sub: `₹${totalWon.toLocaleString('en-IN')} closed` },
            { label: 'Total', value: opportunities.length.toString(), sub: 'all time' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="glass-panel glass-card p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: '#C9A961' }}>{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* FOIR snapshot — shown only when there is an open loan opportunity */}
      <FOIRCalculator lead={lead} opportunities={opportunities} />

      {/* Opportunities section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Opportunities ({opportunities.length})
          </h3>
          <button
            onClick={() => navigate(`/crm/leads/${leadId}/opportunities/new`)}
            className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            <Plus size={14} /> Add Opportunity
          </button>
        </div>

        {oppsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />)}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="glass-panel py-14 text-center" style={{ borderStyle: 'dashed' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No opportunities yet.</p>
            <button
              onClick={() => navigate(`/crm/leads/${leadId}/opportunities/new`)}
              className="mt-3 text-sm font-semibold underline" style={{ color: '#C9A961' }}>
              Add the first opportunity →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {opportunities.map((opp) => {
              const stages = types.find((t) => t.name === opp.product)?.stages ?? [];
              return (
                <OpportunityCard key={opp.id} opp={opp} leadId={lead.id}
                  ownerName={ownerName(opp.ownerId)} stages={stages} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
