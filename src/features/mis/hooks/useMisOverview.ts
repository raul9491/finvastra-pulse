import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, orderBy, limit,
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
// All queries use onSnapshot so the dashboard updates live when data changes.

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

  // ── Commission statements: received totals + open count + discrepancy ───────
  useEffect(() => {
    if (!month) return;
    return onSnapshot(
      query(
        collection(db, 'commission_statements'),
        where('periodStart', '<=', month),
        where('periodEnd', '>=', month),
      ),
      (snap) => {
        let currentMonthReceived = 0;
        let openStatements = 0;
        let discrepancyCount = 0;
        for (const d of snap.docs) {
          const stmt = d.data() as Omit<CommissionStatement, 'id'>;
          if (stmt.status === 'closed' || stmt.status === 'reconciled') {
            currentMonthReceived += stmt.totalAmount ?? 0;
          }
          if (stmt.status !== 'closed') openStatements++;
          discrepancyCount += stmt.discrepancyCount ?? 0;
        }
        setData((prev) => ({
          ...prev,
          currentMonthReceived,
          openStatements,
          discrepancyCount,
          variance: currentMonthReceived - prev.currentMonthExpected,
        }));
      },
      () => {},
    );
  }, [month]);

  // ── Commission records: expected total for this month ────────────────────────
  useEffect(() => {
    if (!month) return;
    const monthStart = `${month}-01`;
    const monthEnd   = `${month}-31`; // safe upper bound for all months
    return onSnapshot(
      query(
        collection(db, 'commission_records'),
        where('expectedPayoutDate', '>=', monthStart),
        where('expectedPayoutDate', '<=', monthEnd),
      ),
      (snap) => {
        let currentMonthExpected = 0;
        for (const d of snap.docs) {
          const rec = d.data() as { calculatedCommission?: number };
          currentMonthExpected += rec.calculatedCommission ?? 0;
        }
        setData((prev) => ({
          ...prev,
          currentMonthExpected,
          variance: prev.currentMonthReceived - currentMonthExpected,
        }));
      },
      () => {},
    );
  }, [month]);

  // ── RM payouts: pending total for this period ────────────────────────────────
  useEffect(() => {
    if (!month) return;
    return onSnapshot(
      query(
        collection(db, 'rm_payouts'),
        where('periodStart', '==', month),
        where('status', 'in', ['draft', 'approved']),
      ),
      (snap) => {
        let pendingPayoutsAmount = 0;
        for (const d of snap.docs) {
          const payout = d.data() as { totalPayout?: number };
          pendingPayoutsAmount += payout.totalPayout ?? 0;
        }
        setData((prev) => ({ ...prev, pendingPayoutsAmount }));
      },
      () => {},
    );
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
