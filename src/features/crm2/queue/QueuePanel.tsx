/**
 * Pull-queue panel for the Pipeline Leads page:
 *  - Telecaller: "Get next lead" (serve-don't-browse) → claims the FIFO front + opens it.
 *  - Manager/admin: a live queue monitor (depth · oldest age · SLA countdown · active reps).
 */
import { useState } from 'react';
import { PhoneIncoming, Users } from 'lucide-react';
import { useQueueActions, useQueueState } from './useQueue';
import { useRmInfo } from '../lib';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

export function QueuePanel({ canWrite, isManager, onOpenLead }: {
  canWrite: boolean;
  isManager: boolean;
  onOpenLead: (leadId: string) => void;
}) {
  const { claimNext, claiming } = useQueueActions();
  const { state } = useQueueState(isManager);   // managers poll; telecallers don't need it
  const rmInfo = useRmInfo();
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

      {isManager && state && state.activeTelecallers.length > 0 && (
        <div className="rounded-lg p-3" style={{ border: '1px solid var(--shell-border)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Users size={11} /> Active reps
          </p>
          {state.activeTelecallers.map((t) => {
            const info = rmInfo(t.fapl);
            return (
              <div key={t.fapl} className="flex items-center gap-2.5 text-xs py-1" style={{ color: 'var(--text-secondary)' }}>
                <span className="relative shrink-0">
                  {info.photoURL ? (
                    <img src={info.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>
                      {initials(info.name)}
                    </span>
                  )}
                  {/* green dot = actively working the queue right now */}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: '#34d399', border: '2px solid var(--ss-bg)' }} />
                </span>
                <span className="flex-1 font-medium truncate" style={{ color: 'var(--text-primary)' }}>{info.name}</span>
                <span className="shrink-0">{t.openClaims} open</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
