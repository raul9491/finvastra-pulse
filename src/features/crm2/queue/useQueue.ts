/**
 * FIFO pull-queue client hooks. Mutations go through /api/crm2/queue/* (server owns
 * the atomic claim); reads (the manager monitor) poll /state every ~10s (no sockets).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCrm2 } from '../lib';

export interface ClaimedLead { id: string; name?: string; mobile?: string; [k: string]: unknown }

export interface QueueStateRow {
  id: string; name: string; depth: number;
  oldestLeadId: string | null;
  oldestWorkingAgeMs: number; oldestWallAgeMs: number;
  slaCountdownMs: number | null;   // < 0 = breached
}
export interface QueueState {
  queues: QueueStateRow[];
  totalWaiting: number;
  activeTelecallers: Array<{ fapl: string; openClaims: number }>;
}

/** Claim the next FIFO lead + release a claimed lead. */
export function useQueueActions() {
  const [claiming, setClaiming] = useState(false);
  const claimNext = useCallback(async (): Promise<ClaimedLead | null> => {
    setClaiming(true);
    try {
      const r = await apiCrm2<{ ok: boolean; lead: ClaimedLead | null }>('POST', '/api/crm2/queue/claim', {});
      return r.lead ?? null;
    } finally { setClaiming(false); }
  }, []);
  const release = useCallback(async (leadId: string, reason: string) => {
    return apiCrm2<{ ok: boolean; releaseCount: number; flagged: boolean }>(
      'POST', '/api/crm2/queue/release', { leadId, reason });
  }, []);
  return { claimNext, release, claiming };
}

/** Poll /state every `intervalMs` (default 10s) while `enabled`. */
export function useQueueState(enabled: boolean, intervalMs = 10_000) {
  const [state, setState] = useState<QueueState | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await apiCrm2<QueueState & { ok: boolean }>('GET', '/api/crm2/queue/state');
        if (alive) { setState(r); setError(''); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'failed');
      } finally {
        if (alive) timer.current = setTimeout(tick, intervalMs);
      }
    };
    tick();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [enabled, intervalMs]);

  return { state, error };
}
