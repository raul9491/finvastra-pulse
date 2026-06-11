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
import { ContactActions, PhoneLink } from '../components/ContactActions';
import { mapsLink, getCurrentPosition } from '../../../lib/geo';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { writeNotification } from '../../../lib/notifications';
import { PresenceChips } from '../components/PresenceChips';
import { QuickLogBar } from '../components/QuickLogBar';
import { LeadActivityFeed } from '../components/LeadActivityFeed';
import { updateWithHistory } from '../../../lib/fieldHistory';
import { FieldHistory } from '../components/FieldHistory';
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
                  : 'var(--shell-hover-hard)',
                outline: active ? '1.5px solid #C9A961' : 'none',
                outlineOffset: '1px',
              }}
            />
            {i < stages.length - 1 && (
              <div className="w-2 h-px shrink-0"
                style={{ backgroundColor: done ? 'rgba(201,169,97,0.40)' : 'var(--shell-hover-hard)' }} />
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
  // CRM managers can work their reports' leads (rules verify the actual
  // reporting relationship via isManagerOf — a wrong manager's write fails).
  const canWorkLead = isAdmin || isPrimaryOwner || profile?.crmRole === 'manager';

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
      // Phase P — status change + field_history diff in ONE batch.
      await updateWithHistory(
        doc(db, 'leads', leadId),
        { leadStatus: { old: lead?.leadStatus ?? null, new: status } },
        { uid: user.uid, name: profile?.displayName ?? '' },
        'disposition',
        {
          leadStatusAt: serverTimestamp(),
          leadStatusBy: user.uid,
          updatedAt:    serverTimestamp(),
          // Closing dispositions clear the SLA so the lead drops out of "overdue" instantly.
          ...(TERMINAL_STATUSES.has(status) ? { slaDeadline: null } : {}),
        },
      );
    } finally {
      setSavingStatus(false);
    }
  };

  // ─── Log a field visit — GPS-tagged meeting on the customer's record ────────────
  // Writes a 'meeting' activity with the RM's current location AND refreshes
  // lead.meetingLocation, so managers see where the customer was last met.
  const [loggingVisit, setLoggingVisit] = useState(false);
  const [visitMessage, setVisitMessage] = useState('');

  const handleLogVisit = async () => {
    if (!leadId || !user) return;
    setLoggingVisit(true);
    setVisitMessage('');
    try {
      const pos = await getCurrentPosition();
      await addDoc(collection(db, 'leads', leadId, 'activities'), {
        type: 'meeting',
        content: `📍 Met ${lead?.displayName ?? 'customer'} on a field visit`,
        location: { lat: pos.lat, lng: pos.lng },
        by: user.uid,
        byName: profile?.displayName ?? '',
        at: serverTimestamp(),
      });
      await updateDoc(doc(db, 'leads', leadId), {
        meetingLocation: { lat: pos.lat, lng: pos.lng, capturedAt: new Date().toISOString() },
        updatedAt: serverTimestamp(),
      });
      setVisitMessage('Visit logged with your location ✓');
      setTimeout(() => setVisitMessage(''), 4000);
    } catch (e) {
      setVisitMessage(e instanceof Error ? e.message : 'Could not log the visit.');
    } finally {
      setLoggingVisit(false);
    }
  };

  // ─── Reassign lead (owner/admin → anyone with CRM access) ───────────────────────
  // The owner-update rule already permits primaryOwnerId changes; this adds the UI.
  const [showReassign, setShowReassign] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [savingReassign, setSavingReassign] = useState(false);

  const handleReassign = async () => {
    if (!leadId || !user || !reassignTo || reassignTo === lead?.primaryOwnerId) return;
    setSavingReassign(true);
    try {
      await updateWithHistory(
        doc(db, 'leads', leadId),
        { primaryOwnerId: { old: lead?.primaryOwnerId ?? null, new: reassignTo } },
        { uid: user.uid, name: profile?.displayName ?? '' },
        'reassign',
        { updatedAt: serverTimestamp() },
      );
      // Activity trail + tell the new owner (both fire-and-forget).
      addDoc(collection(db, 'leads', leadId, 'activities'), {
        type: 'status_change',
        content: `Customer reassigned to ${ownerName(reassignTo)} by ${profile?.displayName ?? 'a colleague'}`,
        by: user.uid,
        byName: profile?.displayName ?? '',
        at: serverTimestamp(),
      }).catch(() => {});
      writeNotification(reassignTo, {
        type: 'new_lead',
        title: 'Customer assigned to you',
        body: `${lead?.displayName ?? 'A customer'} was assigned to you by ${profile?.displayName ?? 'a colleague'}.`,
        link: `/crm/leads/${leadId}`,
      });
      setShowReassign(false);
      setReassignTo('');
    } finally {
      setSavingReassign(false);
    }
  };

  // ─── Callback scheduling (shown when status === 'callback') ─────────────────────
  const [callbackInput, setCallbackInput] = useState('');
  const [savingCallback, setSavingCallback] = useState(false);
  const [showCallback, setShowCallback] = useState(false);
  useEffect(() => {
    if (!lead?.callbackAt) return;
    const d = new Date(lead.callbackAt);
    setCallbackInput(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }, [lead?.callbackAt]);

  const handleSaveCallback = async () => {
    if (!leadId || !user || !callbackInput) return;
    setSavingCallback(true);
    try {
      // Scheduling a follow-up also dispositions the lead as "Callback later".
      await updateDoc(doc(db, 'leads', leadId), {
        leadStatus:   'callback',
        leadStatusAt: serverTimestamp(),
        leadStatusBy: user.uid,
        callbackAt:   new Date(callbackInput).toISOString(),
        callbackReminderSent: false,        // re-arm the reminder
        updatedAt:    serverTimestamp(),
      });
      setShowCallback(false);
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
        <div className="h-5 rounded w-28" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-8 rounded w-56" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-40 rounded-2xl" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
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

      {/* Quick contact bar — shown to the lead's owner, their manager, and admins
          (previously generator-only, which hid Call/WhatsApp from convertors) */}
      {canWorkLead && (
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
              <span>{SOURCE_LABELS[lead.source] ?? lead.source} · Primary RM: {ownerName(lead.primaryOwnerId)}{lead.connectorName ? ` · Connector: ${lead.connectorName}${lead.connectorCode ? ` (${lead.connectorCode})` : ''}` : ''}</span>
              {isAdmin && lead.primaryOwnerId && (
                <Link
                  to={`/hrms/employees/${lead.primaryOwnerId}`}
                  className="inline-flex items-center gap-0.5 text-xs font-medium transition-opacity hover:opacity-70"
                  style={{ color: '#C9A961' }}
                >
                  View HR Profile →
                </Link>
              )}
              {canWorkLead && !showReassign && (
                <button
                  onClick={() => setShowReassign(true)}
                  className="text-xs font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: '#C9A961' }}
                >
                  Reassign
                </button>
              )}
            </p>
            {showReassign && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <div style={{ minWidth: 220 }}>
                  <SearchableSelect
                    value={reassignTo}
                    onChange={setReassignTo}
                    options={employees
                      .filter((e) => (e.crmAccess === true || e.role === 'admin') && e.userId !== lead.primaryOwnerId && e.employeeStatus !== 'inactive')
                      .map((e) => ({ value: e.userId, label: e.displayName }))}
                    placeholder="Assign to…"
                  />
                </div>
                <button
                  onClick={handleReassign}
                  disabled={savingReassign || !reassignTo}
                  className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
                >
                  {savingReassign ? 'Assigning…' : 'Assign'}
                </button>
                <button
                  onClick={() => { setShowReassign(false); setReassignTo(''); }}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Phase P — who else is on this lead right now */}
            <PresenceChips pageKey={leadId ? `lead:${leadId}` : null} />
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
        {canWorkLead && (
          <div className="flex flex-wrap items-center gap-2 mb-5 pb-5" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Status</span>
            {leadId && <FieldHistory parentPath={['leads', leadId]} field="leadStatus" label="Status" />}
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
            {lead.leadStatus !== 'callback' && !showCallback && (
              <button onClick={() => setShowCallback(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-(--shell-hover-soft)"
                style={{ borderColor: 'rgba(201,169,97,0.4)', color: '#C9A961' }}>
                📞 Schedule follow-up
              </button>
            )}
            {/* Field visit — GPS-tagged meeting log for RMs out at the customer's place */}
            <button onClick={handleLogVisit} disabled={loggingVisit}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-(--shell-hover-soft) disabled:opacity-50"
              style={{ borderColor: 'rgba(201,169,97,0.4)', color: '#C9A961' }}>
              {loggingVisit ? 'Getting location…' : '📍 Log visit here'}
            </button>
            {visitMessage && (
              <span className="text-xs font-medium"
                style={{ color: visitMessage.endsWith('✓') ? '#34d399' : '#f87171' }}>
                {visitMessage}
              </span>
            )}
            {(lead.leadStatus === 'callback' || showCallback) && (
              <div className="flex flex-wrap items-center gap-2 w-full mt-1">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Call back at</span>
                <input type="datetime-local" value={callbackInput} onChange={(e) => setCallbackInput(e.target.value)} className="glass-inp text-sm" />
                <button onClick={handleSaveCallback} disabled={savingCallback || !callbackInput}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  {savingCallback ? '…' : (lead.callbackAt ? 'Update reminder' : 'Set reminder')}
                </button>
                {showCallback && lead.leadStatus !== 'callback' && (
                  <button onClick={() => setShowCallback(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                )}
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
            <div className="flex items-center gap-2 flex-wrap">
              <PhoneLink phone={lead.phone} mono={false} className="text-sm font-medium" />
              <ContactActions phone={lead.phone} email={lead.email} name={lead.displayName} size="sm" />
            </div>
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
                    className="text-xs px-2 py-0.5 rounded border hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
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
          {lead.meetingLocation && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Met At</p>
              <a
                href={mapsLink(lead.meetingLocation)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium no-underline hover:underline"
                style={{ color: '#C9A961' }}
              >
                📍 View on map
              </a>
            </div>
          )}
          {(lead.tags ?? []).length > 0 && (
            <div className="col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Tags</p>
              <div className="flex flex-wrap gap-1">
                {lead.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded text-xs bg-(--glass-panel-bg)" style={{ color: 'var(--text-muted)' }}>{tag}</span>
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
            {[1, 2].map((i) => <div key={i} className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />)}
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

      {/* Phase P — lead-level activity feed (filters + day grouping + 5-min edit) */}
      <LeadActivityFeed leadId={lead.id} />

      {/* Phase P — one-tap activity logging */}
      <div className="glass-panel p-5 mt-4">
        <QuickLogBar leadId={lead.id} />
      </div>
    </div>
  );
}
