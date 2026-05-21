import { useState, useEffect } from 'react';
import {
  collection, query, where, getDocs, onSnapshot, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { CommissionStatement, RmPayout } from '../../../types';

// ─── Overview state shape ─────────────────────────────────────────────────────

interface MisOverviewData {
  currentMonthReceived: number;
  currentMonthExpected: number;
  variance: number;
  openStatements: number;
  pendingPayoutsAmount: number;
  discrepancyCount: number;
  recentStatements: CommissionStatement[];
  recentPayouts: RmPayout[];
  loading: boolean;
}

// ─── useMisOverview ───────────────────────────────────────────────────────────
// month = 'YYYY-MM'
// Aggregation queries use getDocs (single-shot on mount/month-change).
// Recent-list queries use onSnapshot for live updates.

export function useMisOverview(month: string): MisOverviewData {
  const [data, setData] = useState<MisOverviewData>({
    currentMonthReceived: 0,
    currentMonthExpected: 0,
    variance: 0,
    openStatements: 0,
    pendingPayoutsAmount: 0,
    discrepancyCount: 0,
    recentStatements: [],
    recentPayouts: [],
    loading: true,
  });

  // ── Aggregation: single-shot on month change ──────────────────────────────
  useEffect(() => {
    if (!month) return;

    let cancelled = false;

    async function loadAggregates() {
      // 1. Commission statements for this period
      //    periodStart <= month AND periodEnd >= month
      const stmtSnap = await getDocs(
        query(
          collection(db, 'commission_statements'),
          where('periodStart', '<=', month),
          where('periodEnd', '>=', month),
        ),
      );

      let currentMonthReceived = 0;
      let openStatements = 0;
      let discrepancyCount = 0;

      for (const d of stmtSnap.docs) {
        const stmt = d.data() as Omit<CommissionStatement, 'id'>;
        if (stmt.status === 'closed' || stmt.status === 'reconciled') {
          currentMonthReceived += stmt.totalAmount ?? 0;
        }
        if (stmt.status !== 'closed') {
          openStatements++;
        }
        discrepancyCount += stmt.discrepancyCount ?? 0;
      }

      // 2. Commission records expected in this month
      //    expectedPayoutDate starts with 'YYYY-MM-'
      //    Firestore doesn't support startsWith, so use range query on date prefix
      const monthStart = `${month}-01`;
      const monthEnd   = `${month}-31`; // safe upper bound for all months

      const recSnap = await getDocs(
        query(
          collection(db, 'commission_records'),
          where('expectedPayoutDate', '>=', monthStart),
          where('expectedPayoutDate', '<=', monthEnd),
        ),
      );

      let currentMonthExpected = 0;
      for (const d of recSnap.docs) {
        const rec = d.data() as { calculatedCommission?: number };
        currentMonthExpected += rec.calculatedCommission ?? 0;
      }

      // 3. RM payouts in draft/approved status for this period
      const payoutSnap = await getDocs(
        query(
          collection(db, 'rm_payouts'),
          where('periodStart', '==', month),
          where('status', 'in', ['draft', 'approved']),
        ),
      );

      let pendingPayoutsAmount = 0;
      for (const d of payoutSnap.docs) {
        const payout = d.data() as { totalPayout?: number };
        pendingPayoutsAmount += payout.totalPayout ?? 0;
      }

      const variance = currentMonthReceived - currentMonthExpected;

      if (!cancelled) {
        setData((prev) => ({
          ...prev,
          currentMonthReceived,
          currentMonthExpected,
          variance,
          openStatements,
          pendingPayoutsAmount,
          discrepancyCount,
        }));
      }
    }

    loadAggregates().catch(() => {
      if (!cancelled) {
        setData((prev) => ({ ...prev, loading: false }));
      }
    });

    return () => { cancelled = true; };
  }, [month]);

  // ── Recent statements: live ───────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'commission_statements'),
        orderBy('importedAt', 'desc'),
        limit(5),
      ),
      (snap) => {
        const recentStatements = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as CommissionStatement),
        );
        setData((prev) => ({ ...prev, recentStatements, loading: false }));
      },
      () => {
        setData((prev) => ({ ...prev, loading: false }));
      },
    );
  }, []);

  // ── Recent payouts: live ──────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'rm_payouts'),
        orderBy('generatedAt', 'desc'),
        limit(5),
      ),
      (snap) => {
        const recentPayouts = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as RmPayout),
        );
        setData((prev) => ({ ...prev, recentPayouts }));
      },
      () => {},
    );
  }, []);

  return data;
}
