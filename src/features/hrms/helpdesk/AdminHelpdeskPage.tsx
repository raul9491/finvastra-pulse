/**
 * AdminHelpdeskPage — HR admin view of all helpdesk tickets.
 * Path: /hrms/admin/hr-helpdesk    Access: admin + isHrmsManager
 *
 * View all tickets, respond with resolution notes, change status,
 * add internal admin notes (not visible to employees).
 */

import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  LifeBuoy, X, Clock, CheckCircle2, Eye, Search,
  ShieldAlert, MessageSquare, StickyNote,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllTickets, updateTicketStatus, updateAdminNotes } from '../hooks/useHrTickets';
import type { HrTicketCategory, HrTicketPriority, HrTicketStatus, HrTicket } from '../../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<HrTicketCategory, { label: string; color: string; bg: string }> = {
  payroll:           { label: 'Payroll',            color: '#0369A1', bg: '#E0F2FE' },
  leave:             { label: 'Leave',              color: '#065F46', bg: '#D1FAE5' },
  attendance:        { label: 'Attendance',         color: '#4C1D95', bg: '#EDE9FE' },
  hr_policy:         { label: 'HR Policy',          color: '#B45309', bg: '#FEF3C7' },
  workplace_concern: { label: 'Workplace',          color: '#D97706', bg: '#FEF9C3' },
  posh:              { label: 'POSH',               color: '#9F1239', bg: '#FFE4E6' },
  it_access:         { label: 'IT / Access',        color: '#374151', bg: '#F3F4F6' },
  other:             { label: 'Other',              color: 'var(--text-muted)', bg: '#F9FAFB'  },
};

const PRIORITY_META: Record<HrTicketPriority, { label: string; color: string }> = {
  low:    { label: 'Low',    color: 'var(--text-muted)' },
  medium: { label: 'Medium', color: '#D97706' },
  high:   { label: 'High',   color: '#EA580C' },
  urgent: { label: 'Urgent', color: '#DC2626' },
};

const STATUS_META: Record<HrTicketStatus, { label: string; color: string; icon: React.ElementType }> = {
  open:      { label: 'Open',       color: '#D97706', icon: Clock        },
  in_review: { label: 'In Review',  color: '#0369A1', icon: Eye          },
  resolved:  { label: 'Resolved',   color: '#059669', icon: CheckCircle2 },
  closed:    { label: 'Closed',     color: 'var(--text-muted)', icon: CheckCircle2 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function CategoryPill({ cat }: { cat: HrTicketCategory }) {
  const m = CATEGORY_META[cat];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
  );
}

function StatusPill({ status }: { status: HrTicketStatus }) {
  const m = STATUS_META[status];
  const Ic = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.color + '18' }}>
      <Ic size={10} />{m.label}
    </span>
  );
}

// ── Respond Modal ─────────────────────────────────────────────────────────────

function RespondModal({
  ticket,
  onClose,
  adminUid,
}: {
  ticket: HrTicket;
  onClose: () => void;
  adminUid: string;
}) {
  const [status,    setStatus]    = useState<HrTicketStatus>(ticket.status);
  const [notes,     setNotes]     = useState(ticket.resolutionNotes ?? '');
  const [adminNts,  setAdminNts]  = useState(ticket.adminNotes ?? '');
  const [saving,    setSaving]    = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (status !== ticket.status || notes !== (ticket.resolutionNotes ?? '')) {
        await updateTicketStatus(ticket.id, status, notes.trim() || null, adminUid);
      }
      if (adminNts !== (ticket.adminNotes ?? '')) {
        await updateAdminNotes(ticket.id, adminNts);
      }
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const inp = 'w-full text-sm px-3.5 py-2.5 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] bg-(--glass-panel-bg)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold">Respond to Ticket</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Ticket summary */}
          <div className="p-4 rounded-xl border border-(--shell-border) space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={ticket.status} />
              <CategoryPill cat={ticket.category} />
              <span className="text-[10px] font-bold" style={{ color: PRIORITY_META[ticket.priority].color }}>
                {PRIORITY_META[ticket.priority].label}
              </span>
            </div>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{ticket.subject}</p>
            {!ticket.isAnonymous && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>From: {ticket.employeeName}</p>
            )}
            {ticket.isAnonymous && (
              <p className="text-xs font-medium" style={{ color: '#9F1239' }}>Anonymous submission</p>
            )}
            <p className="text-sm whitespace-pre-wrap pt-1 border-t border-(--shell-border)" style={{ color: 'var(--text-primary)' }}>
              {ticket.description}
            </p>
          </div>

          {/* Status update */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
              Update Status
            </label>
            <select className={inp} value={status} onChange={(e) => setStatus(e.target.value as HrTicketStatus)}>
              <option value="open">Open</option>
              <option value="in_review">In Review</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Response visible to employee */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
              <MessageSquare size={11} className="inline mr-1" />
              Response to Employee (visible to them)
            </label>
            <textarea className={`${inp} resize-none`} rows={3} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain the resolution, action taken, or next steps…" />
          </div>

          {/* Internal admin notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
              <StickyNote size={11} className="inline mr-1" />
              Internal Notes (HR only — not shown to employee)
            </label>
            <textarea className={`${inp} resize-none`} rows={2} value={adminNts}
              onChange={(e) => setAdminNts(e.target.value)}
              placeholder="Internal HR notes, escalation tracking, etc." />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: '#0B1538' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminHelpdeskPage() {
  const { user, profile } = useAuth();
  const isAdmin     = profile?.role === 'admin';
  const isHrManager = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrManager) return <Navigate to="/hrms/dashboard" replace />;

  const { tickets, loading } = useAllTickets();
  const [statusFilter,   setStatusFilter]   = useState<'all' | HrTicketStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'' | HrTicketCategory>('');
  const [search,         setSearch]         = useState('');
  const [respondTicket,  setRespondTicket]  = useState<HrTicket | null>(null);

  const filtered = useMemo(() => tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.subject.toLowerCase().includes(q) ||
             t.employeeName.toLowerCase().includes(q) ||
             t.description.toLowerCase().includes(q);
    }
    return true;
  }), [tickets, statusFilter, categoryFilter, search]);

  const openCount   = tickets.filter((t) => t.status === 'open' || t.status === 'in_review').length;
  const urgentCount = tickets.filter((t) => t.priority === 'urgent' && t.status !== 'closed').length;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#0B1538' }}>
          <LifeBuoy size={20} style={{ color: '#C9A961' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>
            HR Helpdesk
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Manage employee HR tickets and POSH complaints
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Tickets',   value: tickets.length,                   color: 'var(--text-primary)' },
          { label: 'Open / In Review',value: openCount,                         color: '#D97706' },
          { label: 'Urgent',          value: urgentCount,                       color: '#DC2626' },
          { label: 'POSH Tickets',    value: tickets.filter((t) => t.category === 'posh').length, color: '#9F1239' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status chips */}
        <div className="flex gap-1">
          {(['all', 'open', 'in_review', 'resolved', 'closed'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize ${
                statusFilter === s ? 'text-white' : 'bg-(--glass-panel-bg) border border-(--shell-border) hover:bg-(--glass-panel-bg)'}`}
              style={statusFilter === s && s !== 'all' ? {
                backgroundColor: STATUS_META[s].color,
              } : statusFilter === s ? { backgroundColor: '#0B1538' } : {}}>
              {s === 'in_review' ? 'In Review' : s}
            </button>
          ))}
        </div>
        {/* Category filter */}
        <select className="text-xs px-3 py-1.5 border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
          value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as '' | HrTicketCategory)}>
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_META) as HrTicketCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].label}</option>
          ))}
        </select>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="pl-8 pr-3 py-1.5 text-xs border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
            placeholder="Search tickets…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <LifeBuoy size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No tickets match filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)" style={{ backgroundColor: '#F8F9FC' }}>
                {['Ticket', 'From', 'Category', 'Priority', 'Status', 'Raised', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--shell-border)">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-(--glass-panel-bg) transition-colors">
                  <td className="px-4 py-3 max-w-xs">
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.subject}</p>
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                    {t.adminNotes && (
                      <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#B45309' }}>
                        <StickyNote size={9} />Note
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.isAnonymous
                      ? <span className="flex items-center gap-1 font-medium" style={{ color: '#9F1239' }}>
                          <ShieldAlert size={11} />Anonymous
                        </span>
                      : <span style={{ color: 'var(--text-primary)' }}>{t.employeeName}</span>}
                  </td>
                  <td className="px-4 py-3"><CategoryPill cat={t.category} /></td>
                  <td className="px-4 py-3 text-xs font-semibold"
                    style={{ color: PRIORITY_META[t.priority].color }}>
                    {PRIORITY_META[t.priority].label}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.createdAt ? format(t.createdAt.toDate(), 'd MMM yy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setRespondTicket(t)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                      Respond
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {respondTicket && (
        <RespondModal
          ticket={respondTicket}
          onClose={() => setRespondTicket(null)}
          adminUid={user!.uid}
        />
      )}
    </div>
  );
}
