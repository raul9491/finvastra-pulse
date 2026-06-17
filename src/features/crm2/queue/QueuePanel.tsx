/**
 * Pull-queue panel for the Pipeline Leads page:
 *  - Telecaller: "Get next lead" (serve-don't-browse) → claims the FIFO front + opens it.
 *  - Manager/admin: a live queue monitor (depth · oldest age · SLA countdown · active reps).
 */
import { useState } from 'react';
import { PhoneIncoming, Users, Clock, AlertTriangle } from 'lucide-react';
import { useQueueActions, useQueueState } from './useQueue';

function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function QueuePanel({ canWrite, isManager, onOpenLead }: {
  canWrite: boolean;
  isManager: boolean;
  onOpenLead: (leadId: string) => void;
}) {
  const { claimNext, claiming } = useQueueActions();
  const { state } = useQueueState(isManager);   // managers poll; telecallers don't need it
  const [msg, setMsg] = useState('');

  const getNext = async () => {
    setMsg('');
    try {
      const lead = await claimNext();
      if (!lead) { setMsg('Queue is empty — no leads waiting for you right now.'); return; }
      setMsg(`Claimed ${lead.id} — opening…`);
      onOpenLead(lead.id);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not claim a lead.');
    }
  };

  if (!canWrite && !isManager) return null;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {canWrite && (
          <button onClick={getNext} disabled={claiming}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#E5C97C' }}>
            <PhoneIncoming size={15} /> {claiming ? 'Claiming…' : 'Get next lead'}
          </button>
        )}
        {isManager && state && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {state.totalWaiting} waiting · {state.activeTelecallers.length} active rep{state.activeTelecallers.length === 1 ? '' : 's'}
          </span>
        )}
        {msg && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{msg}</span>}
      </div>

      {isManager && state && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.queues.map((q) => {
            const breached = q.slaCountdownMs != null && q.slaCountdownMs < 0;
            return (
              <div key={q.id} className="rounded-lg p-3"
                style={{ border: '1px solid var(--shell-border)', backgroundColor: 'var(--shell-hover-soft)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{q.name}</span>
                  <span className="text-lg font-bold" style={{ color: q.depth ? '#C9A961' : 'var(--text-muted)' }}>{q.depth}</span>
                </div>
                {q.depth > 0 && (
                  <div className="mt-1.5 flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> oldest {fmtMs(q.oldestWorkingAgeMs)} wk</span>
                    {q.slaCountdownMs != null && (
                      <span className="inline-flex items-center gap-1 font-semibold"
                        style={{ color: breached ? '#f87171' : '#34d399' }}>
                        {breached && <AlertTriangle size={11} />}
                        {breached ? `SLA −${fmtMs(-q.slaCountdownMs)}` : `SLA ${fmtMs(q.slaCountdownMs)} left`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {state.activeTelecallers.length > 0 && (
            <div className="rounded-lg p-3 sm:col-span-2 lg:col-span-1"
              style={{ border: '1px solid var(--shell-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Users size={11} /> Active reps
              </p>
              {state.activeTelecallers.map((t) => (
                <div key={t.fapl} className="flex justify-between text-xs py-0.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-mono">{t.fapl}</span><span>{t.openClaims} open</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
