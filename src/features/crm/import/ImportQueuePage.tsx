import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Inbox, Loader2, Users, CheckCircle2, ArrowLeft } from 'lucide-react';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useImportHistory } from '../hooks/useImportJobs';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { auth, db } from '../../../lib/firebase';
import type { ImportJob, UserProfile } from '../../../types';

// ─── API helper ───────────────────────────────────────────────────────────────
async function apiPost(path: string, body: object) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const fmtDate = (ts: unknown) => {
  if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return format((ts as { toDate: () => Date }).toDate(), 'dd MMM yyyy, HH:mm');
  }
  return '—';
};

// ─── One batch awaiting distribution ───────────────────────────────────────────
function QueueBatchCard({ job, agents, remaining }: { job: ImportJob; agents: UserProfile[]; remaining?: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState('');
  const [perAgent, setPerAgent] = useState('100');   // max contacts per agent this round (0/blank = all)

  const toggle = (uid: string) =>
    setSelected((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));

  const handleDistribute = async () => {
    if (selected.length === 0) return;
    setRunning(true); setError('');
    try {
      await apiPost('/api/import/distribute', { batchId: job.batchId, agentIds: selected, perAgent: Number(perAgent) || 0 });
      // The card disappears when the job's `distributed` flag flips via onSnapshot.
      // Keep the spinner until then.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Distribution failed.');
      setRunning(false);
    }
  };

  // Remaining unassigned = imported minus already-distributed (handles retried rows
  // added to an already-distributed batch). For a never-distributed batch this is
  // just successCount (distributedCount is unset).
  // Prefer the LIVE unassigned count (ground truth); fall back to the counter only
  // while it's loading (the counter can drift, which is what stranded leads earlier).
  const leadCount = remaining ?? Math.max((job.successCount ?? 0) - (job.distributedCount ?? 0), 0);

  return (
    <div className="glass-panel p-6 space-y-4">
      {/* Batch header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {job.importName || job.batchId}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>
            <span className="font-mono">{job.batchId}</span> · {fmtDate(job.startedAt)}
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
          {leadCount} lead{leadCount === 1 ? '' : 's'} awaiting
        </span>
      </div>

      {/* Agent picker */}
      <div className="flex items-center gap-2">
        <Users size={14} style={{ color: '#C9A961' }} />
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
          Route to agents (round-robin)
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setSelected(agents.map((a) => a.userId))}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition-opacity hover:opacity-70"
          style={{ color: 'var(--shell-text-secondary)', borderColor: 'var(--shell-border)' }}>
          Select All
        </button>
        <button onClick={() => setSelected([])}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition-opacity hover:opacity-70"
          style={{ color: 'var(--shell-text-secondary)', borderColor: 'var(--shell-border)' }}>
          Clear
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm" style={{ color: '#f87171' }}>
          No eligible agents found. Assign CRM role "lead_generator" or "lead_convertor" to at least one active employee first.
        </p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 280 }}>
          {agents.map((emp) => {
            const on = selected.includes(emp.userId);
            return (
              <label key={emp.userId}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors nav-item-hover"
                style={{
                  border: `1px solid ${on ? 'rgba(201,169,97,0.35)' : 'var(--shell-border)'}`,
                  backgroundColor: on ? 'rgba(201,169,97,0.07)' : 'transparent',
                }}>
                <input type="checkbox" checked={on} onChange={() => toggle(emp.userId)} className="w-4 h-4" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{emp.displayName}</p>
                  <p className="text-[10px]" style={{ color: 'var(--shell-text-dim)' }}>
                    {emp.designation ?? emp.crmRole ?? 'Agent'}
                  </p>
                </div>
                {on && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(201,169,97,0.20)', color: '#C9A961' }}>
                    Selected
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {/* Per-agent cap — assign at most this many to EACH selected agent; the rest
          stay in the queue for the next round. Blank/0 = assign everything. */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
          Max per agent
        </label>
        <input type="number" min={0} value={perAgent} onChange={(e) => setPerAgent(e.target.value)}
          className="glass-inp w-24 text-sm" placeholder="100" />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          0 = assign all · rest stays in the queue
        </span>
      </div>

      {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

      {(() => {
        const cap = Number(perAgent) || 0;
        const thisRound = cap > 0 ? Math.min(leadCount, cap * (selected.length || 0)) : leadCount;
        return (
          <button onClick={handleDistribute} disabled={selected.length === 0 || running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {running
              ? 'Distributing…'
              : `Assign ${thisRound} lead${thisRound === 1 ? '' : 's'} to ${selected.length || 0} agent${selected.length === 1 ? '' : 's'}${cap > 0 && thisRound < leadCount ? ` (${leadCount - thisRound} stay in queue)` : ''}`}
          </button>
        );
      })()}
    </div>
  );
}

// ─── ImportQueuePage ────────────────────────────────────────────────────────────
export function ImportQueuePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { employees } = useAllEmployees();

  const isAdmin = profile?.role === 'admin';
  const canRun  = isAdmin || profile?.crmRole === 'manager' || profile?.crmCanImport === true;

  const { jobs, loading } = useImportHistory(isAdmin);

  // Agents that can receive leads: generators + convertors (telecallers) + admins, active only.
  const agents = employees.filter(
    (e) =>
      e.employeeStatus !== 'inactive' &&
      (e.role === 'admin' || e.crmRole === 'lead_generator' || e.crmRole === 'lead_convertor'),
  );

  // Candidate batches (two-stage imports that produced leads). Whether one still has
  // leftover UNASSIGNED leads is decided by a LIVE count below — NOT the stored
  // counter, which could drift and strand leads invisibly.
  const candidates = jobs.filter(
    (j) =>
      !!j.importName &&            // only two-stage batches (pre-existing imports were auto-assigned)
      (j.successCount ?? 0) > 0 &&
      (j.status === 'completed' || j.status === 'partial'),
  );

  // Live count of still-UNASSIGNED leads per candidate batch (ground truth).
  const [unassigned, setUnassigned] = useState<Record<string, number>>({});
  const candidateKey = candidates.map((j) => `${j.batchId}:${j.distributedCount ?? 0}`).join('|');
  useEffect(() => {
    if (candidates.length === 0) { setUnassigned({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(candidates.map(async (j) => {
        try {
          const snap = await getCountFromServer(query(
            collection(db, 'leads'),
            where('importBatchId', '==', j.batchId),
            where('primaryOwnerId', '==', 'UNASSIGNED'),
            where('deleted', '==', false),
          ));
          return [j.batchId, snap.data().count] as const;
        } catch {
          return [j.batchId, -1] as const;   // query denied/failed → -1 (use counter fallback)
        }
      }));
      if (!cancelled) setUnassigned(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey]);

  const awaiting = candidates.filter((j) => {
    const u = unassigned[j.batchId];
    if (u === undefined || u < 0) {
      // count not loaded yet (or denied) — fall back to the counter so something shows
      return (j.distributed !== true || (j.successCount ?? 0) > (j.distributedCount ?? 0));
    }
    return u > 0;
  });

  if (!canRun) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="glass-panel p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
            Import access not granted. Ask your admin to enable bulk import for your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/crm/import')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Import
      </button>

      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Import Queue
        </h2>
        <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
          Imported leads wait here unassigned. Pick the agents and distribute each batch round-robin.
        </p>
      </div>

      {loading ? (
        <div className="glass-panel p-6">
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--shell-text-dim)' }} />
        </div>
      ) : awaiting.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <Inbox size={28} className="mx-auto mb-3" style={{ color: 'var(--shell-text-dim)' }} />
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
            Nothing awaiting distribution. Imported batches will appear here.
          </p>
        </div>
      ) : (
        awaiting.map((job) => {
          const r = unassigned[job.batchId];
          return <QueueBatchCard key={job.id} job={job} agents={agents} remaining={r !== undefined && r >= 0 ? r : undefined} />;
        })
      )}
    </div>
  );
}
