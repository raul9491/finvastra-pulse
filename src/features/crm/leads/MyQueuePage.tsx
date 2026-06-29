import { useState, useEffect, useCallback } from 'react';
import { DownloadCloud, Loader2, Inbox } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { auth } from '../../../lib/firebase';
import { useMyLeads } from '../hooks/useMyLeads';
import { MyQueueRow } from './MyQueueRow';

const PULL_LIMIT = 100;   // hard cap — a telecaller can pull at most this many at a time

export function MyQueuePage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const isGenerator = profile?.crmRole === 'lead_generator';
  const isConvertor = profile?.crmRole === 'lead_convertor';
  const isManager   = profile?.crmRole === 'manager';
  const isAdmin     = profile?.role === 'admin';
  const canUse      = isGenerator || isConvertor || isManager || isAdmin;
  // Only managers/admins may see the actual contact LIST (names/phones). Telecallers
  // (generators/convertors) see ONLY a count + a pull control — no contact data is
  // even fetched to their browser (anti-leak).
  const canSeeContacts = isManager || isAdmin;

  const [pulling, setPulling] = useState(false);
  const [pullCount, setPullCount] = useState('100');                 // how many to pull this round (max 100)
  const [available, setAvailable] = useState<number | null>(null);   // count waiting in the pool (number only — never the contacts)

  // Fetch the contact list ONLY for managers/admins. Telecallers pass '' → nothing fetched.
  const { leads, overdue, urgent, total, loading, error } = useMyLeads(
    canSeeContacts ? (user?.uid ?? '') : '',
  );

  // Fetch ONLY the count of pullable contacts (server-side; telecallers can't list the pool).
  const refreshAvailable = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/leads/pull/available', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      setAvailable(res.ok && typeof data.available === 'number' ? data.available : null);
    } catch { setAvailable(null); }
  }, []);

  useEffect(() => { if (canUse) refreshAvailable(); }, [canUse, refreshAvailable]);

  const handlePull = async () => {
    setPulling(true);
    try {
      const n = Math.min(Math.max(Math.floor(Number(pullCount) || PULL_LIMIT), 1), PULL_LIMIT);
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/leads/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ count: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Pull failed (${res.status})`);
      if (data.pulled > 0) toast.success(`${data.pulled} lead${data.pulled === 1 ? '' : 's'} pulled into your queue.`);
      else toast.info('No contacts available to pull right now.');
      refreshAvailable();   // update the waiting count
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
            {canSeeContacts
              ? (loading ? 'Loading…' : `${total} lead${total !== 1 ? 's' : ''} · ${overdue} overdue`)
              : 'Pull contacts to start calling — up to 100 at a time.'}
          </p>
        </div>
      </div>

      {/* ─── Pull panel — shows ONLY the count waiting in the pool, never the contacts.
            Telecaller picks any number up to 100 (hard cap) and claims the oldest. ── */}
      <div className="glass-panel p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between"
        style={{ borderLeft: '3px solid #C9A961' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(201,169,97,0.14)' }}>
            <Inbox size={20} style={{ color: '#C9A961' }} />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
              {available === null ? '—' : available.toLocaleString('en-IN')}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              contact{available === 1 ? '' : 's'} available to pull · oldest first · max {PULL_LIMIT} at a time
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            How many
          </label>
          <input type="number" min={1} max={PULL_LIMIT} value={pullCount}
            onChange={(e) => setPullCount(e.target.value)}
            className="glass-inp w-20 text-sm" aria-label={`How many to pull (max ${PULL_LIMIT})`} />
          <button onClick={handlePull} disabled={pulling || available === 0}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#E5C97C' }}>
            {pulling ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />}
            {pulling ? 'Pulling…' : available === 0 ? 'Nothing to pull' : 'Pull'}
          </button>
        </div>
      </div>

      {/* Everything below — the contact list & queue stats — is MANAGER/ADMIN ONLY.
          Telecallers never see contact names/phones in bulk here (no leak). */}
      {!canSeeContacts ? (
        <div className="glass-panel p-5 space-y-1.5">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Pull contacts, then call them from <span style={{ color: '#C9A961' }}>Customers</span>.
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            The number above is how many are waiting. When you pull, those contacts are assigned to you and
            appear under <b>Customers</b> to call. You only ever see contacts assigned to you — the full list
            stays with your manager.
          </p>
        </div>
      ) : (
        <>
          {/* ─── Stat chips ───────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3">
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full ${overdue > 0 ? 'badge-glass-danger' : 'badge-glass-muted'}`}>
              Overdue<span className="font-bold">{overdue}</span>
            </span>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full ${urgent > 0 ? 'badge-glass-warning' : 'badge-glass-muted'}`}>
              Urgent<span className="font-bold">{urgent}</span>
            </span>
            <span className="badge-glass-muted inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5">
              Total<span className="font-bold">{total}</span>
            </span>
          </div>

          {/* ─── Table header (hidden on narrow) ──────────────────────────── */}
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

          {/* ─── Content ──────────────────────────────────────────────────── */}
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
        </>
      )}
    </div>
  );
}
