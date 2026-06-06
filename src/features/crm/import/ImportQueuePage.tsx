import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Inbox, Loader2, Users, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useImportHistory } from '../hooks/useImportJobs';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { auth } from '../../../lib/firebase';
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
function QueueBatchCard({ job, agents }: { job: ImportJob; agents: UserProfile[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState('');

  const toggle = (uid: string) =>
    setSelected((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));

  const handleDistribute = async () => {
    if (selected.length === 0) return;
    setRunning(true); setError('');
    try {
      await apiPost('/api/import/distribute', { batchId: job.batchId, agentIds: selected });
      // The card disappears when the job's `distributed` flag flips via onSnapshot.
      // Keep the spinner until then.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Distribution failed.');
      setRunning(false);
    }
  };

  const leadCount = job.successCount ?? 0;

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

      {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

      <button onClick={handleDistribute} disabled={selected.length === 0 || running}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {running ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        {running
          ? 'Distributing…'
          : `Distribute ${leadCount} lead${leadCount === 1 ? '' : 's'} to ${selected.length || 0} agent${selected.length === 1 ? '' : 's'}`}
      </button>
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

  // Batches still holding unassigned leads = imported successfully but not yet distributed.
  const awaiting = jobs.filter(
    (j) =>
      !!j.importName &&            // only two-stage batches (pre-existing imports were auto-assigned)
      j.distributed !== true &&
      (j.successCount ?? 0) > 0 &&
      (j.status === 'completed' || j.status === 'partial'),
  );

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
        awaiting.map((job) => <QueueBatchCard key={job.id} job={job} agents={agents} />)
      )}
    </div>
  );
}
