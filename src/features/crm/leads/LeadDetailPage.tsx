import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Plus, TrendingUp, Briefcase, ShieldCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useLead } from '../hooks/useLeads';
import { formatSlaStatus } from '../../../lib/slaUtils';
import { useOpportunities } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { getMaskedPan } from './panUtils';
import { auth, db } from '../../../lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { FOIRCalculator } from './FOIRCalculator';
import { QuickContactBar } from './QuickContactBar';
import type { Opportunity, OpportunityType, OpportunityStatus } from '../../../types';

// ─── Opportunity type icons ───────────────────────────────────────────────────
const TYPE_ICONS: Record<OpportunityType, React.ReactNode> = {
  loan:      <Briefcase size={18} />,
  wealth:    <TrendingUp size={18} />,
  insurance: <ShieldCheck size={18} />,
};

const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: '#EFF6FF', text: '#1D4ED8' },
  wealth:    { bg: '#F0FDF4', text: '#166534' },
  insurance: { bg: '#FFF7ED', text: '#9A3412' },
};

const STATUS_STYLES: Record<OpportunityStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  won:  'bg-emerald-50 text-emerald-700',
  lost: 'bg-red-50 text-red-600',
};

const SOURCE_LABELS: Record<string, string> = {
  website: 'Website', instagram: 'Instagram', facebook: 'Facebook',
  walkin: 'Walk-in', referral: 'Referral', broker: 'Broker',
};

// ─── Opportunity card ─────────────────────────────────────────────────────────
function OpportunityCard({ opp, leadId, ownerName }: {
  opp: Opportunity; leadId: string; ownerName: string;
}) {
  const navigate = useNavigate();
  const col = TYPE_COLORS[opp.opportunityType];

  return (
    <button
      onClick={() => navigate(`/crm/leads/${leadId}/opportunities/${opp.id}`)}
      className="w-full text-left bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: col.bg, color: col.text }}>
            {TYPE_ICONS[opp.opportunityType]}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>{opp.product}</p>
            <p className="text-xs capitalize" style={{ color: '#8B8B85' }}>{opp.opportunityType}</p>
          </div>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${STATUS_STYLES[opp.status]}`}>
          {opp.status}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs" style={{ color: '#8B8B85' }}>Deal Size</p>
          <p className="text-base font-semibold" style={{ color: '#0A0A0A' }}>
            ₹{opp.dealSize.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: '#8B8B85' }}>Stage</p>
          <p className="text-sm" style={{ color: '#2A2A2A' }}>{opp.stage}</p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: '#8B8B85' }}>RM</p>
          <p className="text-sm" style={{ color: '#2A2A2A' }}>{ownerName}</p>
        </div>
        <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
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

  const justCreated = (state as { justCreated?: boolean } | null)?.justCreated;

  const isAdmin = profile?.role === 'admin';
  const isPrimaryOwner = user?.uid === lead?.primaryOwnerId;
  const canEditFinancials = isAdmin || isPrimaryOwner;

  // ─── Financials editing state ─────────────────────────────────────────────────
  const [editingFinancials, setEditingFinancials] = useState(false);
  const [incomeInput, setIncomeInput]             = useState('');
  const [emisInput, setEmisInput]                 = useState('');
  const [savingFinancials, setSavingFinancials]   = useState(false);

  const handleEditFinancials = () => {
    setIncomeInput(lead?.monthlyIncome ? String(lead.monthlyIncome) : '');
    setEmisInput(lead?.existingEmis ? String(lead.existingEmis) : '');
    setEditingFinancials(true);
  };

  const handleSaveFinancials = async () => {
    if (!leadId) return;
    setSavingFinancials(true);
    try {
      await updateDoc(doc(db, 'leads', leadId), {
        monthlyIncome: incomeInput ? Number(incomeInput) : null,
        existingEmis:  emisInput   ? Number(emisInput)   : null,
        updatedAt: serverTimestamp(),
      });
      setEditingFinancials(false);
    } finally {
      setSavingFinancials(false);
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
        <div className="h-5 bg-slate-200 rounded w-28" />
        <div className="h-8 bg-slate-200 rounded w-56" />
        <div className="h-40 bg-slate-100 rounded-2xl" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-20">
        <p style={{ color: '#8B8B85' }}>Customer not found.</p>
        <button onClick={() => navigate('/crm/leads')} className="mt-3 text-sm underline" style={{ color: '#0B1538' }}>
          Back to Customers
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/crm/leads')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: '#8B8B85' }}>
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
          style={{ backgroundColor: '#F2EFE7', color: '#9A7E3F', border: '1px solid #C9A961' }}>
          <span>Customer saved. Now add the first opportunity.</span>
          <button onClick={() => navigate(`/crm/leads/${leadId}/opportunities/new`)}
            className="font-bold underline ml-4">
            Add Opportunity →
          </button>
        </div>
      )}

      {/* Customer card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
              {lead.displayName}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: '#8B8B85' }}>
              {SOURCE_LABELS[lead.source] ?? lead.source} · Primary RM: {ownerName(lead.primaryOwnerId)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
              Consent ✓
            </span>
            {/* SLA indicator */}
            {(() => {
              const sla = formatSlaStatus(lead.slaDeadline);
              if (!sla) return null;
              return (
                <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                  style={{ backgroundColor: sla.overdue ? '#FFF1F2' : sla.hoursLeft < 4 ? '#FFFBEB' : '#EFF6FF', color: sla.overdue ? '#9F1239' : sla.hoursLeft < 4 ? '#92400E' : '#1D4ED8' }}>
                  SLA: {sla.label}
                </span>
              );
            })()}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Phone</p>
            <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{lead.phone}</p>
          </div>
          {lead.email && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Email</p>
              <p className="text-sm" style={{ color: '#0A0A0A' }}>{lead.email}</p>
            </div>
          )}
          {getMaskedPan(lead) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#8B8B85' }}>PAN</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono" style={{ color: '#0A0A0A' }}>
                  {revealedPan ?? getMaskedPan(lead)}
                </p>
                {canRevealPan && !revealedPan && (
                  <button onClick={handleRevealPan} disabled={revealingPan}
                    className="text-xs px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors"
                    style={{ color: '#8B8B85' }}>
                    {revealingPan ? '…' : 'Reveal'}
                  </button>
                )}
                {revealedPan && (
                  <span className="text-xs" style={{ color: '#8B8B85' }}>visible for {revealCountdown}s</span>
                )}
              </div>
              {revealError && <p className="text-xs text-red-500 mt-0.5">{revealError}</p>}
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Added</p>
            <p className="text-sm" style={{ color: '#0A0A0A' }}>
              {lead.createdAt?.toDate ? format(lead.createdAt.toDate(), 'dd MMM yyyy') : '—'}
            </p>
          </div>
          {(lead.tags ?? []).length > 0 && (
            <div className="col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Tags</p>
              <div className="flex flex-wrap gap-1">
                {lead.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Financials section ─────────────────────────────────────────────── */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Financials</p>
            {canEditFinancials && !editingFinancials && (
              <button onClick={handleEditFinancials}
                className="text-xs px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 transition-colors"
                style={{ color: '#8B8B85' }}>
                Edit
              </button>
            )}
          </div>
          {editingFinancials ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Monthly Income ₹</p>
                <input type="number" value={incomeInput} onChange={e => setIncomeInput(e.target.value)}
                  className="text-sm px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none w-full focus:ring-2 transition-colors" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Existing EMIs ₹/month</p>
                <input type="number" value={emisInput} onChange={e => setEmisInput(e.target.value)}
                  className="text-sm px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none w-full focus:ring-2 transition-colors" />
              </div>
              <div className="col-span-2 flex gap-2">
                <button onClick={handleSaveFinancials} disabled={savingFinancials}
                  className="px-4 py-2 text-sm font-semibold rounded-lg transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                  {savingFinancials ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingFinancials(false)}
                  className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                  style={{ color: '#2A2A2A' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Monthly Income</p>
                <p className="text-sm" style={{ color: '#0A0A0A' }}>
                  {lead.monthlyIncome ? `₹${lead.monthlyIncome.toLocaleString('en-IN')}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Existing EMIs</p>
                <p className="text-sm" style={{ color: '#0A0A0A' }}>
                  {lead.existingEmis ? `₹${lead.existingEmis.toLocaleString('en-IN')}/mo` : '—'}
                </p>
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
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: '#0B1538' }}>{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: '#8B8B85' }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* FOIR snapshot — shown only when there is an open loan opportunity */}
      <FOIRCalculator lead={lead} opportunities={opportunities} />

      {/* Opportunities section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
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
            {[1, 2].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-14 text-center">
            <p className="text-sm" style={{ color: '#8B8B85' }}>No opportunities yet.</p>
            <button
              onClick={() => navigate(`/crm/leads/${leadId}/opportunities/new`)}
              className="mt-3 text-sm font-semibold underline" style={{ color: '#0B1538' }}>
              Add the first opportunity →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {opportunities.map((opp) => (
              <OpportunityCard key={opp.id} opp={opp} leadId={lead.id}
                ownerName={ownerName(opp.ownerId)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
