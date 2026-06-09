/**
 * HrHelpdeskPage — Employee self-service HR helpdesk / grievance portal.
 * Path: /hrms/hr-helpdesk    Access: all HRMS employees
 *
 * Raise tickets for payroll issues, leave problems, HR policy queries,
 * workplace concerns, and POSH complaints (anonymous option for sensitive issues).
 */

import { useState } from 'react';
import { format } from 'date-fns';
import {
  LifeBuoy, Plus, X, Clock, CheckCircle2, AlertCircle,
  ShieldAlert, Eye, EyeOff, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyTickets, createTicket } from '../hooks/useHrTickets';
import type { HrTicketCategory, HrTicketPriority, HrTicket } from '../../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<HrTicketCategory, { label: string; color: string; bg: string }> = {
  payroll:           { label: 'Payroll',            color: '#0369A1', bg: '#E0F2FE' },
  leave:             { label: 'Leave',              color: '#065F46', bg: '#D1FAE5' },
  attendance:        { label: 'Attendance',         color: '#4C1D95', bg: '#EDE9FE' },
  hr_policy:         { label: 'HR Policy',          color: '#B45309', bg: '#FEF3C7' },
  workplace_concern: { label: 'Workplace',          color: '#D97706', bg: '#FEF9C3' },
  posh:              { label: 'POSH Complaint',     color: '#9F1239', bg: '#FFE4E6' },
  it_access:         { label: 'IT / System Access', color: '#374151', bg: '#F3F4F6' },
  other:             { label: 'Other',              color: '#6B7280', bg: '#F9FAFB' },
};

const PRIORITY_META: Record<HrTicketPriority, { label: string; color: string }> = {
  low:    { label: 'Low',    color: '#6B7280' },
  medium: { label: 'Medium', color: '#D97706' },
  high:   { label: 'High',   color: '#EA580C' },
  urgent: { label: 'Urgent', color: '#DC2626' },
};

const STATUS_META: Record<HrTicket['status'], { label: string; color: string; icon: React.ElementType }> = {
  open:      { label: 'Open',       color: '#D97706', icon: Clock         },
  in_review: { label: 'In Review',  color: '#0369A1', icon: Eye           },
  resolved:  { label: 'Resolved',   color: '#059669', icon: CheckCircle2  },
  closed:    { label: 'Closed',     color: '#6B7280', icon: CheckCircle2  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function CategoryPill({ cat }: { cat: HrTicketCategory }) {
  const m = CATEGORY_META[cat];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
  );
}

function StatusPill({ status }: { status: HrTicket['status'] }) {
  const m = STATUS_META[status];
  const Ic = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.color + '18' }}>
      <Ic size={10} />{m.label}
    </span>
  );
}

// ── New Ticket Modal ──────────────────────────────────────────────────────────

interface TicketForm {
  category: HrTicketCategory;
  subject: string;
  description: string;
  priority: HrTicketPriority;
  isAnonymous: boolean;
}

const BLANK: TicketForm = {
  category: 'other', subject: '', description: '',
  priority: 'medium', isAnonymous: false,
};

function NewTicketModal({
  employeeId,
  employeeName,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}) {
  const [form, setForm]   = useState<TicketForm>(BLANK);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof TicketForm>(k: K, v: TicketForm[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!form.subject.trim())     errs.subject     = 'Required';
    if (!form.description.trim()) errs.description = 'Required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await createTicket({
        employeeId,
        employeeName,
        category:      form.category,
        subject:       form.subject.trim(),
        description:   form.description.trim(),
        priority:      form.priority,
        isAnonymous:   form.isAnonymous,
        attachmentUrl: null,
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const inp = (f?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors ${
      f && errors[f] ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                      : 'border-(--shell-border) focus:ring-[#0B1538]'}`;

  const lbl = (text: string, f?: string, req = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: f && errors[f] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{req && <span className="text-red-500 ml-0.5">*</span>}
      {f && errors[f] && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {errors[f]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold">Raise HR Ticket</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Anonymous toggle — show first for POSH category */}
          <div className="p-3 rounded-xl border border-(--shell-border) flex items-start gap-3">
            <button
              type="button"
              onClick={() => set('isAnonymous', !form.isAnonymous)}
              className="mt-0.5 shrink-0"
            >
              {form.isAnonymous
                ? <EyeOff size={18} style={{ color: '#9F1239' }} />
                : <Eye    size={18} style={{ color: 'var(--text-muted)' }} />}
            </button>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {form.isAnonymous ? 'Anonymous — your identity is hidden' : 'Submit as yourself'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {form.isAnonymous
                  ? 'HR will not know who submitted this ticket. Recommended for POSH / sensitive complaints.'
                  : 'Your name will be visible to HR. Tap the icon to submit anonymously.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              {lbl('Category')}
              <select className={inp()} value={form.category}
                onChange={(e) => {
                  const cat = e.target.value as HrTicketCategory;
                  set('category', cat);
                  // Auto-set anonymous for POSH
                  if (cat === 'posh') set('isAnonymous', true);
                }}>
                {(Object.keys(CATEGORY_META) as HrTicketCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              {lbl('Priority')}
              <select className={inp()} value={form.priority}
                onChange={(e) => set('priority', e.target.value as HrTicketPriority)}>
                {(Object.keys(PRIORITY_META) as HrTicketPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            {lbl('Subject', 'subject', true)}
            <input className={inp('subject')} value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              placeholder="Brief summary of the issue" />
          </div>

          <div>
            {lbl('Description', 'description', true)}
            <textarea className={`${inp('description')} resize-none`} rows={4}
              value={form.description} onChange={(e) => set('description', e.target.value)}
              placeholder="Describe the issue in detail. Include relevant dates, amounts, or names." />
          </div>

          {form.category === 'posh' && (
            <div className="p-3 rounded-xl flex items-start gap-2"
              style={{ backgroundColor: '#FFF1F2', borderLeft: '3px solid #DC2626' }}>
              <ShieldAlert size={15} style={{ color: '#DC2626' }} className="mt-0.5 shrink-0" />
              <p className="text-xs" style={{ color: '#9F1239' }}>
                POSH complaints are handled by the Internal Complaints Committee (ICC) with strict confidentiality.
                Your identity will be protected. HR cannot disclose your complaint without your consent.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--text-primary)' }}>
            {saving ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ticket Detail Panel ───────────────────────────────────────────────────────

function TicketDetailPanel({ ticket, onClose }: { ticket: HrTicket; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <div className="flex items-center gap-2">
            <StatusPill status={ticket.status} />
            <CategoryPill cat={ticket.category} />
          </div>
          <button onClick={onClose} className="text-(--text-muted) hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Subject</p>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{ticket.subject}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Description</p>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{ticket.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-(--shell-border)">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Priority</p>
              <p className="text-sm font-semibold" style={{ color: PRIORITY_META[ticket.priority].color }}>
                {PRIORITY_META[ticket.priority].label}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Raised on</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {ticket.createdAt ? format(ticket.createdAt.toDate(), 'd MMM yyyy') : '—'}
              </p>
            </div>
          </div>
          {ticket.resolutionNotes && (
            <div className="p-4 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#059669' }}>HR Response</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: '#1A3A2A' }}>{ticket.resolutionNotes}</p>
              {ticket.resolvedAt && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  Resolved on {format(ticket.resolvedAt.toDate(), 'd MMM yyyy')}
                </p>
              )}
            </div>
          )}
          {(ticket.status === 'open' || ticket.status === 'in_review') && !ticket.resolutionNotes && (
            <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
              Your ticket is with HR. They'll respond as soon as possible.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function HrHelpdeskPage() {
  const { user, profile } = useAuth();
  const { tickets, loading } = useMyTickets(user?.uid ?? '');
  const [showNew,      setShowNew]      = useState(false);
  const [detailTicket, setDetailTicket] = useState<HrTicket | null>(null);

  const open     = tickets.filter((t) => t.status === 'open' || t.status === 'in_review');
  const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed');

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--text-primary)' }}>
            <LifeBuoy size={20} style={{ color: '#C9A961' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>
              HR Helpdesk
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Raise HR queries, payroll issues, or workplace concerns
            </p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white"
          style={{ backgroundColor: 'var(--text-primary)' }}>
          <Plus size={15} />Raise Ticket
        </button>
      </div>

      {/* Info strip for POSH */}
      <div className="p-4 rounded-xl flex items-start gap-3 border border-(--shell-border) bg-(--glass-panel-bg)">
        <ShieldAlert size={18} style={{ color: '#9F1239' }} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>POSH Act Protection</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Under the Prevention of Sexual Harassment Act 2013, you have the right to report workplace harassment confidentially.
            Select "POSH Complaint" to auto-anonymise your submission. Your identity will be protected.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-16 text-center">
          <LifeBuoy size={40} className="mx-auto mb-4 opacity-20" />
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>No tickets yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Use "Raise Ticket" for payroll queries, leave issues, HR policy questions, or workplace concerns.
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#D97706' }}>
                Open Tickets ({open.length})
              </h2>
              <div className="space-y-3">
                {open.map((t) => (
                  <button key={t.id} onClick={() => setDetailTicket(t)}
                    className="w-full text-left bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4 hover:border-slate-300 transition-colors flex items-center gap-4">
                    <AlertCircle size={18} style={{ color: PRIORITY_META[t.priority].color }} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t.subject}</span>
                        <StatusPill status={t.status} />
                        <CategoryPill cat={t.category} />
                      </div>
                      <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {resolved.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#059669' }}>
                Resolved ({resolved.length})
              </h2>
              <div className="space-y-3">
                {resolved.map((t) => (
                  <button key={t.id} onClick={() => setDetailTicket(t)}
                    className="w-full text-left bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4 hover:border-(--shell-border) transition-colors opacity-70 flex items-center gap-4">
                    <CheckCircle2 size={18} style={{ color: '#059669' }} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{t.subject}</span>
                        <StatusPill status={t.status} />
                        <CategoryPill cat={t.category} />
                      </div>
                      {t.resolvedAt && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          Resolved {format(t.resolvedAt.toDate(), 'd MMM yyyy')}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {showNew && (
        <NewTicketModal
          employeeId={user!.uid}
          employeeName={profile?.displayName ?? 'Employee'}
          onClose={() => setShowNew(false)}
        />
      )}

      {detailTicket && (
        <TicketDetailPanel ticket={detailTicket} onClose={() => setDetailTicket(null)} />
      )}
    </div>
  );
}
