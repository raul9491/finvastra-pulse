import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { UserMinus, Clock, FileText, Monitor, Package, BookOpen, Circle, IndianRupee, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import type { OffboardingChecklist, ChecklistItem, ChecklistStatus, ChecklistItemCategory, FnFStatus } from '../../../types';
import { EXIT_REASON_LABELS } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';
import { ChecklistDetail, type OffboardingFilter } from './ChecklistDetail';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

export function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}

const STATUS_META: Record<ChecklistStatus, { label: string; bg: string; color: string }> = {
  pending:     { label: 'Pending',     bg: '#FFFBEB', color: '#92400E' },
  in_progress: { label: 'In Progress', bg: '#EFF6FF', color: '#1D4ED8' },
  completed:   { label: 'Completed',   bg: '#F0FDF4', color: '#166534' },
};

const FNF_STATUS_META: Record<FnFStatus, { label: string; bg: string; color: string }> = {
  pending:    { label: 'FnF Pending',    bg: '#FFF1F2', color: '#BE123C' },
  calculated: { label: 'FnF Calculated', bg: '#FFF7ED', color: '#C2410C' },
  settled:    { label: 'FnF Settled',    bg: '#F0FDF4', color: '#166534' },
};

export const CATEGORY_META: Record<ChecklistItemCategory, { label: string; icon: typeof FileText; color: string }> = {
  documents:          { label: 'Documents',          icon: FileText,    color: '#3B82F6' },
  system_access:      { label: 'System Access',      icon: Monitor,     color: '#8B5CF6' },
  assets:             { label: 'Assets',             icon: Package,     color: '#F59E0B' },
  induction:          { label: 'Induction',          icon: BookOpen,    color: '#10B981' },
  knowledge_transfer: { label: 'Knowledge Transfer', icon: BookOpen,    color: '#0EA5E9' },
  crm:                { label: 'CRM Reassignment',   icon: AlertCircle, color: '#DC2626' },
  other:              { label: 'Other',              icon: Circle,      color: 'var(--text-muted)' },
};

export function statusBadge(status: ChecklistStatus) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: m.bg, color: m.color }}>
      <Clock size={10} />{m.label}
    </span>
  );
}

export function fnfBadge(status: FnFStatus) {
  const m = FNF_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: m.bg, color: m.color }}>
      <IndianRupee size={10} />{m.label}
    </span>
  );
}

export function progressBar(items: ChecklistItem[]) {
  const done = items.filter(i => i.completed).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-(--glass-panel-bg) rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#ef4444' }} />
      </div>
      <span className="text-xs text-muted whitespace-nowrap">{done}/{total}</span>
    </div>
  );
}

export function OffboardingPage() {
  const { profile, user } = useAuth();

  // All hooks before guard
  const [checklists, setChecklists] = useState<OffboardingChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OffboardingFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OffboardingChecklist | null>(null);

  const isAdmin = profile?.role === 'admin';
  const isHrmsManager = !!profile?.isHrmsManager;
  const canAccess = isAdmin || isHrmsManager;

  useEffect(() => {
    if (!canAccess) return;
    const q = query(collection(db, 'offboarding_checklists'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() } as OffboardingChecklist)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [canAccess]);

  // Guard after hooks
  if (profile && !canAccess) return <Navigate to="/hrms/dashboard" replace />;

  const filtered = checklists.filter(c => {
    if (filter === 'fnf_pending') return c.fnfStatus === 'pending' || c.fnfStatus === 'calculated';
    if (filter === 'fnf_settled') return c.fnfStatus === 'settled';
    if (filter !== 'all' && c.status !== filter) return false;
    if (search && !c.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).filter(c => !search || c.employeeName.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    pending:     checklists.filter(c => c.status === 'pending').length,
    in_progress: checklists.filter(c => c.status === 'in_progress').length,
    completed:   checklists.filter(c => c.status === 'completed').length,
    fnf_pending: checklists.filter(c => c.fnfStatus !== 'settled').length,
    fnf_settled: checklists.filter(c => c.fnfStatus === 'settled').length,
  };

  if (selected) {
    return (
      <div className="max-w-2xl mx-auto">
        <ChecklistDetail
          checklist={selected}
          currentUid={user?.uid ?? ''}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="p-2 rounded-xl" style={{ background: '#FFF1F2' }}>
              <UserMinus size={20} style={{ color: '#BE123C' }} />
            </span>
            Offboarding
          </span>
        }
        subtitle={`${checklists.length} checklist${checklists.length !== 1 ? 's' : ''}`}
        pinKey="hrms.offboarding"
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          ['all',         checklists.length, '#F8FAFC', 'var(--text-muted)', 'All'],
          ['pending',     counts.pending,    '#FFFBEB', '#92400E', 'Pending'],
          ['in_progress', counts.in_progress,'#EFF6FF', '#1D4ED8', 'In Progress'],
          ['completed',   counts.completed,  '#F0FDF4', '#166534', 'Completed'],
          ['fnf_pending', counts.fnf_pending,'#FFF1F2', '#BE123C', 'FnF Pending'],
        ] as const).map(([f, n, bg, color, label]) => (
          <button key={f}
            onClick={() => setFilter(filter === f ? 'all' : f)}
            className="rounded-2xl p-3 text-left border transition-all"
            style={{
              background: bg,
              borderColor: filter === f ? color : 'transparent',
              outline: filter === f ? `2px solid ${color}` : undefined,
            }}>
            <p className="text-xl font-bold" style={{ color }}>{n}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color }}>{label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <input type="search" placeholder="Search by employee name…" value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm">No checklists found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const done = c.items.filter(i => i.completed).length;
            const total = c.items.length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            const createdDate = toDate(c.createdAt);
            const isFnFUrgent = c.fnfStatus !== 'settled';

            return (
              <button key={c.id} onClick={() => setSelected(c)}
                className="w-full bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm text-left hover:border-red-200 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-(--text-primary)">{c.employeeName}</span>
                      {statusBadge(c.status)}
                      {isFnFUrgent && fnfBadge(c.fnfStatus)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted mt-0.5 flex-wrap">
                      {c.lastWorkingDate && <span>LWD: {c.lastWorkingDate}</span>}
                      {c.exitReason && <span>{EXIT_REASON_LABELS[c.exitReason]}</span>}
                      {createdDate && <span>Created {format(createdDate, 'dd MMM yyyy')}</span>}
                    </div>
                  </div>
                  <span className="text-lg font-bold shrink-0"
                    style={{ color: pct === 100 ? '#16a34a' : '#ef4444' }}>
                    {pct}%
                  </span>
                </div>
                <div className="mt-3">
                  {progressBar(c.items)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
