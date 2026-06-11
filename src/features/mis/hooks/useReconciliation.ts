import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, getDocs, getDoc, updateDoc,
  doc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { maybeCreateDispute, type DisputeSeed } from './useDisputes';
import type { StatementLine, StatementLineStatus, CommissionRecord } from '../../../types';

// ─── useUnmatchedLines ────────────────────────────────────────────────────────

export function useUnmatchedLines(statementId: string | null): {
  lines: StatementLine[];
  loading: boolean;
} {
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!statementId) {
      setLines([]);
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(
        collection(db, 'commission_statements', statementId, 'lines'),
        where('status', '==', 'unmatched'),
      ),
      (snap) => {
        setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementLine)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [statementId]);

  return { lines, loading };
}

// ─── useLinesByStatus ─────────────────────────────────────────────────────────

interface LinesByStatus {
  unmatched: StatementLine[];
  matched: StatementLine[];
  discrepancy: StatementLine[];
  excluded: StatementLine[];
}

export function useLinesByStatus(statementId: string | null): {
  allLines: StatementLine[];
  byStatus: LinesByStatus;
  loading: boolean;
} {
  const [allLines, setAllLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!statementId) {
      setAllLines([]);
      setLoading(false);
      return;
    }
    return onSnapshot(
      collection(db, 'commission_statements', statementId, 'lines'),
      (snap) => {
        setAllLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementLine)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [statementId]);

  const byStatus: LinesByStatus = {
    unmatched:   allLines.filter((l) => l.status === 'unmatched'),
    matched:     allLines.filter((l) => l.status === 'matched'),
    discrepancy: allLines.filter((l) => l.status === 'discrepancy'),
    excluded:    allLines.filter((l) => l.status === 'excluded'),
  };

  return { allLines, byStatus, loading };
}

// ─── autoMatch ────────────────────────────────────────────────────────────────

export async function autoMatch(
  statementId: string,
  providerId: string,
): Promise<{ matched: number; discrepancy: number }> {
  // 1. Load all unmatched lines for this statement
  const linesSnap = await getDocs(
    query(
      collection(db, 'commission_statements', statementId, 'lines'),
      where('status', '==', 'unmatched'),
    ),
  );

  // 2. Load all paid commission_records for this providerId
  const recordsSnap = await getDocs(
    query(
      collection(db, 'commission_records'),
      where('providerId', '==', providerId),
      where('status', '==', 'paid'),
    ),
  );

  const records = recordsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as CommissionRecord & { id: string }),
  );
  const usedRecordIds = new Set<string>();

  let matched = 0;
  let discrepancy = 0;

  const updates: Array<{
    lineId: string;
    recordId: string;
    status: StatementLineStatus;
    discrepancyAmount: number | null;
    // Phase P — seed for auto-creating a commission dispute on >5% variance
    disputeSeed?: DisputeSeed;
  }> = [];

  // 3. Score each unmatched line against every available commission record
  for (const lineDoc of linesSnap.docs) {
    const line = { id: lineDoc.id, ...lineDoc.data() } as StatementLine;
    let bestScore = 0;
    let bestRecord: (CommissionRecord & { id: string }) | null = null;

    for (const record of records) {
      if (usedRecordIds.has(record.id)) continue;
      let score = 0;

      // Amount within 5%: score +50
      const amountPct =
        Math.abs(line.parsedAmount - record.calculatedCommission) /
        Math.max(record.calculatedCommission, 1);
      if (amountPct <= 0.05) score += 50;

      // Date within 30 days: score +30
      const lineDateMs = new Date(line.parsedDate).getTime();
      const recDateMs  = new Date(record.expectedPayoutDate).getTime();
      if (
        !isNaN(lineDateMs) &&
        !isNaN(recDateMs) &&
        Math.abs(lineDateMs - recDateMs) <= 30 * 86_400_000
      ) {
        score += 30;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRecord = record;
      }
    }

    // 4. Accept match only if score >= 50 (amount match is mandatory)
    if (bestRecord !== null && bestScore >= 50) {
      usedRecordIds.add(bestRecord.id);
      const diffPct =
        Math.abs(line.parsedAmount - bestRecord.calculatedCommission) /
        Math.max(bestRecord.calculatedCommission, 1);
      const status: StatementLineStatus = diffPct <= 0.02 ? 'matched' : 'discrepancy';
      const discrepancyAmount =
        status === 'discrepancy' ? line.parsedAmount - bestRecord.calculatedCommission : null;
      updates.push({
        lineId: line.id, recordId: bestRecord.id, status, discrepancyAmount,
        ...(status === 'discrepancy' ? {
          disputeSeed: {
            commissionRecordId: bestRecord.id,
            statementLineId:    line.id,
            providerId:         bestRecord.providerId,
            opportunityId:      bestRecord.opportunityId,
            leadId:             bestRecord.leadId,
            expectedAmount:     bestRecord.calculatedCommission,
            receivedAmount:     line.parsedAmount,
          },
        } : {}),
      });
      if (status === 'matched') matched++;
      else discrepancy++;
    }
  }

  // 5. Write all updates in batches of 499 (Firestore batch limit)
  for (let i = 0; i < updates.length; i += 499) {
    const batch = writeBatch(db);
    for (const u of updates.slice(i, i + 499)) {
      batch.update(
        doc(db, 'commission_statements', statementId, 'lines', u.lineId),
        {
          status: u.status,
          matchedCommissionRecordId: u.recordId,
          discrepancyAmount: u.discrepancyAmount,
        },
      );
    }
    await batch.commit();
  }

  // 5b. Phase P — auto-create disputes for >5% variances (deduped inside;
  //     fire-and-forget so reconciliation never blocks on it)
  for (const u of updates) {
    if (u.disputeSeed) void maybeCreateDispute(u.disputeSeed);
  }

  // 6. Update statement-level counts and status
  const unmatchedAfter = linesSnap.size - updates.length;
  await updateDoc(doc(db, 'commission_statements', statementId), {
    matchedCount: matched,
    discrepancyCount: discrepancy,
    unmatchedCount: unmatchedAfter,
    status:
      unmatchedAfter === 0
        ? discrepancy > 0
          ? 'discrepancy'
          : 'reconciled'
        : 'reconciling',
  });

  return { matched, discrepancy };
}

// ─── manualMatch ──────────────────────────────────────────────────────────────

export async function manualMatch(
  statementId: string,
  lineId: string,
  commissionRecordId: string,
  reconciledBy: string,
  lineAmount: number,
  recordAmount: number,
): Promise<void> {
  const diffPct =
    Math.abs(lineAmount - recordAmount) / Math.max(recordAmount, 1);
  const status: StatementLineStatus = diffPct <= 0.02 ? 'matched' : 'discrepancy';
  const discrepancyAmount =
    status === 'discrepancy' ? lineAmount - recordAmount : null;

  await updateDoc(
    doc(db, 'commission_statements', statementId, 'lines', lineId),
    {
      status,
      matchedCommissionRecordId: commissionRecordId,
      discrepancyAmount,
      reconciledBy,
      reconciledAt: serverTimestamp(),
    },
  );

  // Phase P — auto-create a dispute when the manual match lands as a
  // >5% discrepancy (deduped + fire-and-forget inside maybeCreateDispute).
  if (status === 'discrepancy') {
    try {
      const recSnap = await getDoc(doc(db, 'commission_records', commissionRecordId));
      if (recSnap.exists()) {
        const rec = recSnap.data() as CommissionRecord;
        void maybeCreateDispute({
          commissionRecordId,
          statementLineId: lineId,
          providerId:      rec.providerId,
          opportunityId:   rec.opportunityId,
          leadId:          rec.leadId,
          expectedAmount:  recordAmount,
          receivedAmount:  lineAmount,
        });
      }
    } catch { /* never block manual matching */ }
  }
}

// ─── unmatch ──────────────────────────────────────────────────────────────────

export async function unmatch(statementId: string, lineId: string): Promise<void> {
  await updateDoc(
    doc(db, 'commission_statements', statementId, 'lines', lineId),
    {
      status: 'unmatched',
      matchedCommissionRecordId: null,
      discrepancyAmount: null,
    },
  );
}

// ─── excludeLine ─────────────────────────────────────────────────────────────

export async function excludeLine(
  statementId: string,
  lineId: string,
  reason: string,
  reconciledBy: string,
): Promise<void> {
  await updateDoc(
    doc(db, 'commission_statements', statementId, 'lines', lineId),
    {
      status: 'excluded',
      notes: reason,
      reconciledBy,
      reconciledAt: serverTimestamp(),
    },
  );
}
