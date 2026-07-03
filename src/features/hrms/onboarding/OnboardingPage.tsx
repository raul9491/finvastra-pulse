import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, onSnapshot, doc, updateDoc, serverTimestamp,
  query, orderBy, getDoc, getDocs, setDoc, where,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import {
  UserPlus, ChevronLeft, Check, Clock, CheckCircle2,
  FileText, Monitor, Package, BookOpen, Circle, Zap,
} from 'lucide-react';
import { format } from 'date-fns';
import type {
  OnboardingChecklist, ChecklistItem, ChecklistStatus, ChecklistItemCategory,
} from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

const STATUS_META: Record<ChecklistStatus, { label: string; bg: string; color: string; icon: typeof Clock }> = {
  pending:     { label: 'Pending',     bg: '#FFFBEB', color: '#92400E', icon: Clock },
  in_progress: { label: 'In Progress', bg: '#EFF6FF', color: '#1D4ED8', icon: Clock },
  completed:   { label: 'Completed',   bg: '#F0FDF4', color: '#166534', icon: CheckCircle2 },
};

const CATEGORY_META: Record<ChecklistItemCategory, { label: string; icon: typeof FileText; color: string }> = {
  documents:          { label: 'Documents',          icon: FileText,  color: '#3B82F6' },
  system_access:      { label: 'System Access',      icon: Monitor,   color: '#8B5CF6' },
  assets:             { label: 'Assets',             icon: Package,   color: '#F59E0B' },
  induction:          { label: 'Induction',          icon: BookOpen,  color: '#10B981' },
  knowledge_transfer: { label: 'Knowledge Transfer', icon: BookOpen,  color: '#0EA5E9' },
  crm:                { label: 'CRM',                icon: Zap,       color: '#DC2626' },
  other:              { label: 'Other',              icon: Circle,    color: 'var(--text-muted)' },
};

function statusBadge(status: ChecklistStatus) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: m.bg, color: m.color }}>
      <m.icon size={10} />
      {m.label}
    </span>
  );
}

function progressBar(items: ChecklistItem[]) {
  const done = items.filter(i => i.completed).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-(--glass-panel-bg) rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#C9A961' }} />
      </div>
      <span className="text-xs text-muted whitespace-nowrap">{done}/{total}</span>
    </div>
  );
}

// ─── Tick Item Modal ──────────────────────────────────────────────────────────

function TickItemModal({
  item, checklistId, uid,
  onClose,
}: {
  item: ChecklistItem;
  checklistId: string;
  uid: string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async (complete: boolean) => {
    setSaving(true);
    try {
      const ref = doc(db, 'onboarding_checklists', checklistId);
      // We fetch the latest doc to avoid overwriting concurrent changes
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() as Omit<OnboardingChecklist, 'id'>;
      const updatedItems = data.items.map(i =>
        i.id === item.id
          ? {
              ...i,
              completed: complete,
              completedAt: complete ? serverTimestamp() : null,
              completedBy: complete ? uid : null,
              notes: notes.trim() || null,
            }
          : i
      );

      const allDone = updatedItems.every(i => i.completed);
      const anyDone = updatedItems.some(i => i.completed);
      const newStatus: ChecklistStatus = allDone ? 'completed' : anyDone ? 'in_progress' : 'pending';

      await updateDoc(ref, {
        items: updatedItems,
        status: newStatus,
        completedAt: allDone ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">{item.task}</h3>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
          <textarea
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-gold/30"
            rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Add a note…" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">
            Cancel
          </button>
          {item.completed && (
            <button onClick={() => handleSave(false)} disabled={saving}
              className="flex-1 border border-amber-200 rounded-xl py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors">
              Mark Incomplete
            </button>
          )}
          {!item.completed && (
            <button onClick={() => handleSave(true)} disabled={saving}
              className="flex-1 bg-navy text-white rounded-xl py-2 text-sm font-semibold hover:bg-navy-soft transition-colors flex items-center justify-center gap-1.5">
              <Check size={14} />
              Mark Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function ChecklistDetail({
  checklist,
  currentUid,
  onBack,
}: {
  checklist: OnboardingChecklist;
  currentUid: string;
  onBack: () => void;
}) {
  const [tickingItem, setTickingItem] = useState<ChecklistItem | null>(null);

  // Group items by category
  const grouped = Object.entries(
    checklist.items.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {})
  ) as [ChecklistItemCategory, ChecklistItem[]][];

  const done = checklist.items.filter(i => i.completed).length;
  const total = checklist.items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={onBack}
          className="mt-0.5 p-2 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-(--text-primary)">{checklist.employeeName}</h2>
            {statusBadge(checklist.status)}
          </div>
          {checklist.joiningDate && (
            <p className="text-sm text-muted mt-0.5">
              Joined {checklist.joiningDate}
            </p>
          )}
        </div>
      </div>

      {/* Progress card */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-(--text-primary)">Overall Progress</span>
          <span className="text-2xl font-bold" style={{ color: pct === 100 ? '#16a34a' : '#C9A961' }}>
            {pct}%
          </span>
        </div>
        <div className="bg-(--glass-panel-bg) rounded-full h-2.5 overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#C9A961' }} />
        </div>
        <p className="text-xs text-muted mt-2">{done} of {total} tasks completed</p>
      </div>

      {/* Items by category */}
      {grouped.map(([cat, items]) => {
        const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
        const catDone = items.filter(i => i.completed).length;
        return (
          <div key={cat} className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-(--shell-border)"
              style={{ background: `${meta.color}10` }}>
              <meta.icon size={15} style={{ color: meta.color }} />
              <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="ml-auto text-xs text-muted">{catDone}/{items.length}</span>
            </div>
            <ul className="divide-y divide-(--shell-border)">
              {items.map(item => (
                <li key={item.id}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-(--glass-panel-bg) transition-colors cursor-pointer"
                  onClick={() => setTickingItem(item)}>
                  <div className="mt-0.5 shrink-0">
                    {item.completed
                      ? <CheckCircle2 size={18} className="text-green-500" />
                      : <div className="w-4.5 h-4.5 rounded-full border-2 border-(--shell-border-mid)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${item.completed ? 'line-through text-muted' : 'text-(--text-primary)'}`}>
                      {item.task}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-muted mt-0.5 truncate">{item.notes}</p>
                    )}
                    {item.completedAt && (
                      <p className="text-xs text-muted mt-0.5">
                        {format(toDate(item.completedAt)!, 'dd MMM yyyy')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {tickingItem && (
        <TickItemModal
          item={tickingItem}
          checklistId={checklist.id}
          uid={currentUid}
          onClose={() => setTickingItem(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Default checklist items (mirrors server.ts buildOnboardingItems) ──────────

function buildDefaultOnboardingItems(): ChecklistItem[] {
  return [
    // Documents
    { id: 'ob_doc_offer',     category: 'documents',     task: 'Offer letter signed and collected',                  completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_appoint',   category: 'documents',     task: 'Appointment letter issued',                          completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_pan',       category: 'documents',     task: 'PAN card copy collected',                            completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_aadhaar',   category: 'documents',     task: 'Aadhaar copy collected (do not store number)',       completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_bank',      category: 'documents',     task: 'Bank account details collected',                     completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_emergency', category: 'documents',     task: 'Emergency contact details collected',                completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_edu',       category: 'documents',     task: 'Educational certificates verified',                  completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_doc_prevexp',   category: 'documents',     task: 'Previous employment documents verified',             completed: false, completedAt: null, completedBy: null, notes: null },
    // System Access
    { id: 'ob_sys_email',     category: 'system_access', task: '@finvastra.com email created in Google Workspace',   completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_sys_pulse',     category: 'system_access', task: 'Added to Finvastra Pulse (this system)',             completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_sys_whatsapp',  category: 'system_access', task: 'Added to relevant WhatsApp groups',                  completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_sys_drive',     category: 'system_access', task: 'Added to Google Drive shared folders',               completed: false, completedAt: null, completedBy: null, notes: null },
    // Assets
    { id: 'ob_asset_laptop',  category: 'assets',        task: 'Laptop issued (update asset management)',            completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_asset_sim',     category: 'assets',        task: 'SIM card issued (update asset management)',          completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_asset_card',    category: 'assets',        task: 'Access card issued (if applicable)',                 completed: false, completedAt: null, completedBy: null, notes: null },
    // Induction
    { id: 'ob_ind_policy',    category: 'induction',     task: 'HR policy walkthrough done',                         completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_ind_posh',      category: 'induction',     task: 'POSH policy acknowledged',                           completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_ind_manager',   category: 'induction',     task: 'Reporting manager introduction done',                completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_ind_team',      category: 'induction',     task: 'Team introduction done',                             completed: false, completedAt: null, completedBy: null, notes: null },
    { id: 'ob_ind_kpi',       category: 'induction',     task: 'Role and KPIs explained',                            completed: false, completedAt: null, completedBy: null, notes: null },
  ];
}

export function OnboardingPage() {
  const { profile, user } = useAuth();

  // All hooks unconditionally at top
  const [checklists, setChecklists] = useState<OnboardingChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ChecklistStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OnboardingChecklist | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const isHrmsManager = !!profile?.isHrmsManager;
  const canAccess = isAdmin || isHrmsManager;

  // ── Bulk generate for all active employees ─────────────────────────────────
  const handleGenerateAll = async () => {
    if (!user?.uid) return;
    setGenerating(true);
    setGenerateResult(null);
    try {
      // Fetch all active employees
      const usersSnap = await getDocs(
        query(collection(db, 'users'), where('employeeStatus', '!=', 'inactive'))
      );
      // IDs that already have a checklist
      const existingIds = new Set(checklists.map(c => c.id));

      let created = 0;
      const writes = usersSnap.docs
        .filter(d => !existingIds.has(d.id))
        .map(async d => {
          const u = d.data();
          await setDoc(doc(db, 'onboarding_checklists', d.id), {
            employeeId:   d.id,
            employeeName: u.displayName ?? 'Unknown',
            joiningDate:  u.joiningDate ?? null,
            createdAt:    serverTimestamp(),
            createdBy:    user.uid,
            status:       'pending',
            completedAt:  null,
            items:        buildDefaultOnboardingItems(),
          });
          created++;
        });

      await Promise.all(writes);
      setGenerateResult(
        created === 0
          ? 'All active employees already have checklists.'
          : `Created ${created} onboarding checklist${created !== 1 ? 's' : ''}.`
      );
    } catch (e) {
      setGenerateResult('Error generating checklists — please try again.');
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!canAccess) return;
    const q = query(collection(db, 'onboarding_checklists'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() } as OnboardingChecklist)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [canAccess]);

  // Guard after hooks
  if (profile && !canAccess) return <Navigate to="/hrms/dashboard" replace />;

  const filtered = checklists.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search && !c.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts: Record<ChecklistStatus, number> = {
    pending:     checklists.filter(c => c.status === 'pending').length,
    in_progress: checklists.filter(c => c.status === 'in_progress').length,
    completed:   checklists.filter(c => c.status === 'completed').length,
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
      {/* Page header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="p-2 rounded-xl" style={{ background: '#EFF6FF' }}>
              <UserPlus size={20} style={{ color: '#1D4ED8' }} />
            </span>
            Onboarding
          </span>
        }
        subtitle={`${checklists.length} checklist${checklists.length !== 1 ? 's' : ''}`}
        pinKey="hrms.onboarding"
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={handleGenerateAll}
              disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              <Zap size={14} />
              {generating ? 'Generating…' : 'Generate for all active employees'}
            </button>
            {generateResult && (
              <p className={`text-xs px-3 py-1.5 rounded-lg ${
                generateResult.startsWith('Error')
                  ? 'bg-red-50 text-red-600'
                  : generateResult.includes('already')
                  ? 'bg-(--glass-panel-bg) text-muted'
                  : 'bg-green-50 text-green-700'
              }`}>
                {generateResult}
              </p>
            )}
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([
          ['pending',     counts.pending,     '#FFFBEB', '#92400E'],
          ['in_progress', counts.in_progress, '#EFF6FF', '#1D4ED8'],
          ['completed',   counts.completed,   '#F0FDF4', '#166534'],
        ] as const).map(([s, n, bg, color]) => (
          <button key={s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className="rounded-2xl p-4 text-left border transition-all"
            style={{
              background: bg,
              borderColor: statusFilter === s ? color : 'transparent',
              outline: statusFilter === s ? `2px solid ${color}` : undefined,
            }}>
            <p className="text-2xl font-bold" style={{ color }}>{n}</p>
            <p className="text-xs font-medium capitalize mt-0.5" style={{ color }}>
              {STATUS_META[s].label}
            </p>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Search by employee name…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30"
      />

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

            return (
              <button key={c.id} onClick={() => setSelected(c)}
                className="w-full bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm text-left hover:border-gold/60 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-(--text-primary)">{c.employeeName}</span>
                      {statusBadge(c.status)}
                    </div>
                    {c.joiningDate && (
                      <p className="text-xs text-muted mt-0.5">Joined {c.joiningDate}</p>
                    )}
                    {createdDate && (
                      <p className="text-xs text-muted">
                        Created {format(createdDate, 'dd MMM yyyy')}
                      </p>
                    )}
                  </div>
                  <span className="text-lg font-bold shrink-0"
                    style={{ color: pct === 100 ? '#16a34a' : '#C9A961' }}>
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
