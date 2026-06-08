import { useEffect, useState } from 'react';
import {
  collection, collectionGroup, doc, getDocs, onSnapshot, query, where,
  setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { RmTarget, RmActuals } from '../../../types';

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Achievement %, 0–100, capped at 100. Returns 0 when target is 0/undefined. */
export function achievementPct(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

const monthStartMs = (period: string): number => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).getTime();
};

const tsMs = (v: any): number =>
  v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : 0);

// ─── Actuals — computed live from Firestore, never stored ────────────────────
// Index-safe: each query uses a single equality filter; the period/date narrowing
// happens in memory (small dataset at 25-person scale).

export async function computeActuals(uid: string, period: string): Promise<RmActuals> {
  if (!uid) return { newLeads: 0, leadsConverted: 0, disbursalAmount: 0, commissionGenerated: 0 };
  const startMs = monthStartMs(period);

  // newLeads — leads owned by this RM, created this month, not deleted
  const leadsSnap = await getDocs(
    query(collection(db, 'leads'), where('primaryOwnerId', '==', uid), where('deleted', '==', false)),
  );
  let newLeads = 0;
  leadsSnap.forEach((d) => { if (tsMs(d.data().createdAt) >= startMs) newLeads++; });

  // leadsConverted — won opportunities owned by this RM, closed this period
  const wonSnap = await getDocs(
    query(collectionGroup(db, 'opportunities'), where('status', '==', 'won')),
  );
  let leadsConverted = 0;
  wonSnap.forEach((d) => {
    const o = d.data() as any;
    if (o.ownerId === uid && typeof o.actualCloseDate === 'string' && o.actualCloseDate.startsWith(period)) {
      leadsConverted++;
    }
  });

  // disbursalAmount + commissionGenerated — from this RM's commission records
  const crSnap = await getDocs(
    query(collection(db, 'commission_records'), where('rmOwnerId', '==', uid)),
  );
  let disbursalAmount = 0;
  let commissionGenerated = 0;
  crSnap.forEach((d) => {
    const r = d.data() as any;
    if (typeof r.disbursalDate === 'string' && r.disbursalDate.startsWith(period)) {
      disbursalAmount += Number(r.disbursedAmount ?? 0);
    }
    if (r.status === 'paid' && typeof r.actualPayoutDate === 'string' && r.actualPayoutDate.startsWith(period)) {
      commissionGenerated += Number(r.actualAmount ?? r.calculatedCommission ?? 0);
    }
  });

  return { newLeads, leadsConverted, disbursalAmount, commissionGenerated };
}

// ─── Write a target (admin / manager) ────────────────────────────────────────

export async function setTarget(
  uid: string,
  period: string,
  targets: RmTarget['targets'],
  meta: { rmName: string; setBy: string },
): Promise<void> {
  await setDoc(doc(db, 'rm_targets', `${uid}_${period}`), {
    rmId: uid,
    rmName: meta.rmName,
    period,
    targets,
    setBy: meta.setBy,
    setAt: serverTimestamp(),
  });
}

// ─── useMyTargets — own targets + live actuals ────────────────────────────────

export function useMyTargets(uid: string | undefined, period: string) {
  const [target, setTargetState] = useState<RmTarget | null>(null);
  const [actuals, setActuals] = useState<RmActuals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'rm_targets', `${uid}_${period}`), (snap) => {
      setTargetState(snap.exists() ? (snap.data() as RmTarget) : null);
    }, () => setTargetState(null)); // unset doc / denied → treat as "no target"
    return unsub;
  }, [uid, period]);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    setLoading(true);
    computeActuals(uid, period)
      .then((a) => { if (alive) setActuals(a); })
      .catch(() => { if (alive) setActuals({ newLeads: 0, leadsConverted: 0, disbursalAmount: 0, commissionGenerated: 0 }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid, period]);

  return { target, actuals, loading };
}

// ─── useTeamTargets — all RMs (manager / admin) ───────────────────────────────

export interface TeamTargetRow {
  rmId: string;
  rmName: string;
  target: RmTarget | null;
  actuals: RmActuals;
}

export function useTeamTargets(period: string, enabled: boolean) {
  const [rows, setRows] = useState<TeamTargetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading(true);

    (async () => {
      const startMs = monthStartMs(period);

      // Active CRM staff
      const usersSnap = await getDocs(collection(db, 'users'));
      const rms = usersSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((u) =>
          u.employeeStatus !== 'inactive' &&
          (u.role === 'admin' || u.crmAccess === true ||
            u.crmRole === 'lead_generator' || u.crmRole === 'lead_convertor' || u.crmRole === 'manager'));

      // Targets for the period (one query)
      const targetsSnap = await getDocs(query(collection(db, 'rm_targets'), where('period', '==', period)));
      const targetByRm = new Map<string, RmTarget>();
      targetsSnap.forEach((d) => { const t = d.data() as RmTarget; targetByRm.set(t.rmId, t); });

      // Bulk source data — fetched once, aggregated per RM in memory
      const [leadsSnap, wonSnap, crSnap] = await Promise.all([
        getDocs(query(collection(db, 'leads'), where('deleted', '==', false))),
        getDocs(query(collectionGroup(db, 'opportunities'), where('status', '==', 'won'))),
        getDocs(collection(db, 'commission_records')),
      ]);

      const blank = (): RmActuals => ({ newLeads: 0, leadsConverted: 0, disbursalAmount: 0, commissionGenerated: 0 });
      const actualsByRm = new Map<string, RmActuals>();
      const get = (id: string) => { if (!actualsByRm.has(id)) actualsByRm.set(id, blank()); return actualsByRm.get(id)!; };

      leadsSnap.forEach((d) => {
        const l = d.data() as any;
        if (l.primaryOwnerId && tsMs(l.createdAt) >= startMs) get(l.primaryOwnerId).newLeads++;
      });
      wonSnap.forEach((d) => {
        const o = d.data() as any;
        if (o.ownerId && typeof o.actualCloseDate === 'string' && o.actualCloseDate.startsWith(period)) {
          get(o.ownerId).leadsConverted++;
        }
      });
      crSnap.forEach((d) => {
        const r = d.data() as any;
        if (!r.rmOwnerId) return;
        if (typeof r.disbursalDate === 'string' && r.disbursalDate.startsWith(period)) {
          get(r.rmOwnerId).disbursalAmount += Number(r.disbursedAmount ?? 0);
        }
        if (r.status === 'paid' && typeof r.actualPayoutDate === 'string' && r.actualPayoutDate.startsWith(period)) {
          get(r.rmOwnerId).commissionGenerated += Number(r.actualAmount ?? r.calculatedCommission ?? 0);
        }
      });

      const out: TeamTargetRow[] = rms.map((u) => ({
        rmId: u.id,
        rmName: u.displayName ?? u.email ?? u.id,
        target: targetByRm.get(u.id) ?? null,
        actuals: actualsByRm.get(u.id) ?? blank(),
      })).sort((a, b) => b.actuals.disbursalAmount - a.actuals.disbursalAmount);

      if (alive) { setRows(out); setLoading(false); }
    })().catch(() => { if (alive) { setRows([]); setLoading(false); } });

    return () => { alive = false; };
  }, [period, enabled]);

  return { rows, loading };
}
