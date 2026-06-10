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
  const badgeClass =
    status === 'won'  ? 'badge-glass-success' :
    status === 'lost' ? 'badge-glass-danger'  : 'badge-glass-info';
  return (
    <span className={badgeClass}>
      {status === 'won' ? '✓ Won' : status === 'lost' ? '✗ Lost' : stage}
    </span>
  );
}

// ─── Expandable lead row ──────────────────────────────────────────────────────

function LeadRow({ lead }: { lead: Lead }) {
  const [expanded, setExpanded] = useState(false);
  const [opps, setOpps]         = useState<Opportunity[]>([]);
  const [oppsLoading, setOppsLoading] = useState(false);

  // suppress unused warning — toggleExpand kept for ref compatibility
  void useEffect;

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
        className="hover:bg-(--shell-hover-soft) cursor-pointer transition-colors"
        style={{ borderBottom: '1px solid var(--shell-border)' }}
        onClick={handleClick}
      >
        {/* Name */}
        <td className="py-3.5 pl-5 pr-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{ backgroundColor: '#1B2A4E', color: '#C9A961' }}>
              {lead.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{lead.displayName}</span>
          </div>
        </td>

        {/* Phone */}
        <td className="py-3.5 px-3 text-sm" style={{ color: 'var(--text-primary)' }}>
          <span className="font-mono">{lead.phone}</span>
        </td>

        {/* Product interest */}
        <td className="py-3.5 px-3">
          {productTag ? (
            <span className="badge-glass-warning inline-flex items-center gap-1">
              <Tag size={10} />
              {productTag}
            </span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>

        {/* Stage */}
        <td className="py-3.5 px-3">
          {oppsLoading && !expanded ? (
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          ) : opps.length > 0 ? (
            <StageBadge stage={opps[0].stage} status={opps[0].status} />
          ) : expanded ? (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No opportunities yet</span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>

        {/* Submitted */}
        <td className="py-3.5 px-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {submittedAt}
        </td>

        {/* Expand toggle */}
        <td className="py-3.5 pr-5 pl-3 text-right">
          {oppsLoading ? (
            <Loader2 size={14} className="animate-spin ml-auto" style={{ color: 'var(--text-muted)' }} />
          ) : expanded ? (
            <ChevronUp size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
          ) : (
            <ChevronDown size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <td colSpan={6} className="px-5 py-4" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
            <div className="space-y-4">

              {/* Lead contact info */}
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <Phone size={13} style={{ color: 'var(--text-muted)' }} />
                  <span className="font-mono">{lead.phone}</span>
                </div>
                {lead.email && (
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                    <Mail size={13} style={{ color: 'var(--text-muted)' }} />
                    {lead.email}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={12} />
                  Submitted {submittedAt}
                </div>
              </div>

              {/* Tags */}
              {lead.tags && lead.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((t) => (
                    <span key={t} className="badge-glass-warning">{t}</span>
                  ))}
                </div>
              )}

              {/* Opportunities */}
              {opps.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Opportunities
                  </p>
                  <div className="space-y-2">
                    {opps.map((opp) => (
                      <div key={opp.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ border: '1px solid var(--shell-border-mid)', backgroundColor: 'var(--shell-hover-soft)' }}>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opp.product}</span>
                          <span className="badge-glass-muted">{opp.opportunityType}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {opp.dealSize > 0 && (
                            <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
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
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>My Referrals</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Track leads you've submitted — follow their progress through the CRM pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/crm/referrals/import')}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition-colors hover:bg-(--shell-hover-soft)"
            style={{ borderColor: 'var(--shell-border-mid)', color: 'var(--text-primary)' }}
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
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin" style={{ color: '#C9A961' }} />
          </div>
        ) : leads.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: 'rgba(201,169,97,0.12)' }}>
              <Tag size={22} style={{ color: '#C9A961' }} />
            </div>
            <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No referrals yet
            </h3>
            <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-muted)' }}>
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
              <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <th className="py-3 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>Name</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>Phone</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>Product Interest</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>Stage</th>
                <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>Submitted</th>
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
        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          {leads.length} referral{leads.length === 1 ? '' : 's'} submitted · Click any row to see pipeline details
        </p>
      )}
    </div>
  );
}
