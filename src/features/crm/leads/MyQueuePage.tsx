import { useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { auth } from '../../../lib/firebase';
import { useMyLeads } from '../hooks/useMyLeads';
import { MyQueueRow } from './MyQueueRow';

export function MyQueuePage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const isGenerator = profile?.crmRole === 'lead_generator';
  const isConvertor = profile?.crmRole === 'lead_convertor';
  const isManager   = profile?.crmRole === 'manager';
  const isAdmin     = profile?.role === 'admin';
  const canUse      = isGenerator || isConvertor || isManager || isAdmin;

  const [pullCount, setPullCount] = useState('100');
  const [pulling, setPulling] = useState(false);

  // Always call the hook — skip logic handled by userId being empty
  const { leads, overdue, urgent, total, loading, error } = useMyLeads(
    canUse ? (user?.uid ?? '') : '',
  );

  const handlePull = async () => {
    setPulling(true);
    try {
      const n = Math.min(Math.max(Number(pullCount) || 100, 1), 200);
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/leads/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ count: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Pull failed (${res.status})`);
      if (data.pulled > 0) toast.success(`${data.pulled} lead${data.pulled === 1 ? '' : 's'} pulled into your queue.`);
      else toast.info('No unassigned contacts left in the pool right now.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setPulling(false);
    }
  };

  // Access guard
  if (!canUse) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center space-y-3">
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Access Denied</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          My Queue is only available to telecallers (Lead Generators / Convertors) and managers.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-3xl"
            style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontWeight: 300,
              color: 'var(--text-primary)',
            }}
          >
            My Queue
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {loading
              ? 'Loading…'
              : `${total} lead${total !== 1 ? 's' : ''} · ${overdue} overdue`}
          </p>
        </div>

        {/* Self-serve: pull a chunk of the oldest unassigned imported contacts to me */}
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={200} value={pullCount} onChange={(e) => setPullCount(e.target.value)}
            className="glass-inp w-20 text-sm" aria-label="How many to pull" />
          <button onClick={handlePull} disabled={pulling}
            title="Claim this many of the oldest unassigned contacts into your queue"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#E5C97C' }}>
            {pulling ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
            {pulling ? 'Pulling…' : 'Pull leads'}
          </button>
        </div>
      </div>

      {/* ─── Stat chips ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full ${overdue > 0 ? 'badge-glass-danger' : 'badge-glass-muted'}`}
        >
          Overdue
          <span className="font-bold">{overdue}</span>
        </span>

        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full ${urgent > 0 ? 'badge-glass-warning' : 'badge-glass-muted'}`}
        >
          Urgent
          <span className="font-bold">{urgent}</span>
        </span>

        <span
          className="badge-glass-muted inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5"
        >
          Total
          <span className="font-bold">{total}</span>
        </span>
      </div>

      {/* ─── Table header (hidden on narrow) ──────────────────────────────── */}
      {!loading && leads.length > 0 && (
        <div className="hidden sm:flex items-center gap-4 px-5 py-2">
          <div className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Name</div>
          <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Contact</div>
          <div className="hidden md:block w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Product</div>
          <div className="hidden lg:block w-20 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Source</div>
          <div className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>SLA</div>
          <div className="hidden md:block flex-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Stage</div>
          <div className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Actions</div>
        </div>
      )}

      {/* ─── Content ──────────────────────────────────────────────────────── */}
      {error ? (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--status-danger)' }}>Failed to load queue: {error}</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="py-20 text-center space-y-2">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Your queue is clear.</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No leads in your queue. New assignments will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((item) => (
            <MyQueueRow key={item.lead.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
