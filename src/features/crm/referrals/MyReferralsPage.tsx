import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';
import { Plus, Upload, ChevronDown, ChevronUp, Phone, Mail, Tag, Clock, Loader2 } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useMyReferrals } from '../hooks/useLeads';
import { format } from 'date-fns';
import type { Lead, Opportunity } from '../../../types';

// ─── Opportunity stage badge ──────────────────────────────────────────────────

function StageBadge({ stage, status }: { stage: string; status: string }) {
  const color =
    status === 'won'  ? { bg: '#D1FAE5', text: '#065F46' } :
    status === 'lost' ? { bg: '#FEE2E2', text: '#991B1B' } :
                        { bg: '#EFF6FF', text: '#1D4ED8' };
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: color.bg, color: color.text }}>
      {status === 'won' ? '✓ Won' : status === 'lost' ? '✗ Lost' : stage}
    </span>
  );
}

// ─── Expandable lead row ──────────────────────────────────────────────────────

function LeadRow({ lead }: { lead: Lead }) {
  const [expanded, setExpanded] = useState(false);
  const [opps, setOpps]         = useState<Opportunity[]>([]);
  const [oppsLoading, setOppsLoading] = useState(false);

  const toggleExpand = () => {
    if (!expanded && opps.length === 0) {
      setOppsLoading(true);
      const q = query(
        collection(db, 'leads', lead.id, 'opportunities'),
        orderBy('createdAt', 'desc'),
      );
      const unsub = onSnapshot(q, (snap) => {
        setOpps(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opportunity)));
        setOppsLoading(false);
      }, () => setOppsLoading(false));
      // Store unsub; simplified: just fire once. For a real-time refresh, keep it mounted.
      return unsub;
    }
    setExpanded((v) => !v);
  };

  const handleClick = () => {
    if (!expanded && opps.length === 0 && !oppsLoading) {
      setOppsLoading(true);
      const q = query(
        collection(db, 'leads', lead.id, 'opportunities'),
        orderBy('createdAt', 'desc'),
      );
      onSnapshot(q, (snap) => {
        setOpps(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opportunity)));
        setOppsLoading(false);
        setExpanded(true);
      }, () => { setOppsLoading(false); setExpanded(true); });
    } else {
      setExpanded((v) => !v);
    }
  };

  const submittedAt = lead.createdAt?.toDate
    ? format(lead.createdAt.toDate(), 'd MMM yyyy')
    : '—';

  const productTag = lead.tags?.[0] ?? null;

  return (
    <>
      <tr
        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
        onClick={handleClick}
      >
        {/* Name */}
        <td className="py-3.5 pl-5 pr-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{ backgroundColor: '#1B2A4E', color: '#C9A961' }}>
              {lead.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{lead.displayName}</span>
          </div>
        </td>

        {/* Phone */}
        <td className="py-3.5 px-3 text-sm" style={{ color: '#2A2A2A' }}>
          <span className="font-mono">{lead.phone}</span>
        </td>

        {/* Product interest */}
        <td className="py-3.5 px-3">
          {productTag ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
              <Tag size={10} />
              {productTag}
            </span>
          ) : (
            <span className="text-xs" style={{ color: '#8B8B85' }}>—</span>
          )}
        </td>

        {/* Stage */}
        <td className="py-3.5 px-3">
          {oppsLoading && !expanded ? (
            <Loader2 size={13} className="animate-spin" style={{ color: '#8B8B85' }} />
          ) : opps.length > 0 ? (
            <StageBadge stage={opps[0].stage} status={opps[0].status} />
          ) : expanded ? (
            <span className="text-xs" style={{ color: '#8B8B85' }}>No opportunities yet</span>
          ) : (
            <span className="text-xs" style={{ color: '#8B8B85' }}>—</span>
          )}
        </td>

        {/* Submitted */}
        <td className="py-3.5 px-3 text-xs" style={{ color: '#8B8B85' }}>
          {submittedAt}
        </td>

        {/* Expand toggle */}
        <td className="py-3.5 pr-5 pl-3 text-right">
          {oppsLoading ? (
            <Loader2 size={14} className="animate-spin ml-auto" style={{ color: '#8B8B85' }} />
          ) : expanded ? (
            <ChevronUp size={14} style={{ color: '#8B8B85', marginLeft: 'auto' }} />
          ) : (
            <ChevronDown size={14} style={{ color: '#8B8B85', marginLeft: 'auto' }} />
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={6} className="px-5 py-4" style={{ backgroundColor: '#F8F9FC' }}>
            <div className="space-y-4">

              {/* Lead contact info */}
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5" style={{ color: '#2A2A2A' }}>
                  <Phone size={13} style={{ color: '#8B8B85' }} />
                  <span className="font-mono">{lead.phone}</span>
                </div>
                {lead.email && (
                  <div className="flex items-center gap-1.5" style={{ color: '#2A2A2A' }}>
                    <Mail size={13} style={{ color: '#8B8B85' }} />
                    {lead.email}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#8B8B85' }}>
                  <Clock size={12} />
                  Submitted {submittedAt}
                </div>
              </div>

              {/* Tags */}
              {lead.tags && lead.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Opportunities */}
              {opps.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>
                    Opportunities
                  </p>
                  <div className="space-y-2">
                    {opps.map((opp) => (
                      <div key={opp.id} className="flex items-center justify-between px-3 py-2 rounded-lg border"
                        style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }}>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{opp.product}</span>
                          <span className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                            {opp.opportunityType}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {opp.dealSize > 0 && (
                            <span className="text-xs font-mono" style={{ color: '#2A2A2A' }}>
                              ₹{(opp.dealSize / 100000).toFixed(1)}L
                            </span>
                          )}
                          <StageBadge stage={opp.stage} status={opp.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: '#8B8B85' }}>
                  No opportunities added yet — a tele-caller will pick this lead up and create an opportunity.
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MyReferralsPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const uid       = user?.uid ?? '';

  const { leads, loading } = useMyReferrals(uid);

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: '#0A0A0A' }}>My Referrals</h2>
          <p className="text-sm mt-0.5" style={{ color: '#8B8B85' }}>
            Track leads you've submitted — follow their progress through the CRM pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/crm/referrals/import')}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50"
            style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
          >
            <Upload size={14} />
            Import CSV
          </button>
          <button
            onClick={() => navigate('/crm/referrals/new')}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg font-medium transition-colors"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            <Plus size={14} />
            Submit Lead
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin" style={{ color: '#C9A961' }} />
          </div>
        ) : leads.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#FEF3C7' }}>
              <Tag size={22} style={{ color: '#C9A961' }} />
            </div>
            <h3 className="text-base font-semibold mb-1" style={{ color: '#0A0A0A' }}>
              No referrals yet
            </h3>
            <p className="text-sm mb-6 max-w-xs" style={{ color: '#8B8B85' }}>
              Know someone looking for a home loan, insurance, or investment? Submit their details and
              our team will take it from there.
            </p>
            <button
              onClick={() => navigate('/crm/referrals/new')}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg font-medium"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              <Plus size={14} />
              Submit your first lead
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                <th className="py-3 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#8B8B85' }}>Name</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#8B8B85' }}>Phone</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#8B8B85' }}>Product Interest</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#8B8B85' }}>Stage</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#8B8B85' }}>Submitted</th>
                <th className="py-3 pr-5 pl-3" />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {leads.length > 0 && (
        <p className="text-xs text-center" style={{ color: '#8B8B85' }}>
          {leads.length} referral{leads.length === 1 ? '' : 's'} submitted · Click any row to see pipeline details
        </p>
      )}
    </div>
  );
}
