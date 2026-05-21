import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, doc, updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { CommissionStatement, StatementLine } from '../../../types';

export function useStatements() {
  const [statements, setStatements] = useState<CommissionStatement[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'commission_statements'), orderBy('importedAt', 'desc')),
      (snap) => {
        setStatements(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommissionStatement)));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);
  return { statements, loading };
}

export function useStatement(statementId: string | null) {
  const [statement, setStatement] = useState<CommissionStatement | null>(null);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!statementId) return;
    const unsubStmt = onSnapshot(doc(db, 'commission_statements', statementId), snap => {
      setStatement(snap.exists() ? { id: snap.id, ...snap.data() } as CommissionStatement : null);
    });
    const unsubLines = onSnapshot(
      collection(db, 'commission_statements', statementId, 'lines'),
      snap => {
        setLines(snap.docs.map(d => ({ id: d.id, ...d.data() } as StatementLine)));
        setLoading(false);
      }
    );
    return () => { unsubStmt(); unsubLines(); };
  }, [statementId]);
  return { statement, lines, loading };
}

export async function closeStatement(statementId: string, closedBy: string): Promise<void> {
  await updateDoc(doc(db, 'commission_statements', statementId), {
    status: 'closed',
    closedBy,
    closedAt: serverTimestamp(),
  });
}

export function exportStatementCsv(statement: CommissionStatement, lines: StatementLine[]): void {
  const header = 'Date,Description,Amount,Status,Matched Record,Notes';
  const rows = lines.map(l =>
    [l.parsedDate, `"${l.rawDescription.replace(/"/g, '""')}"`, l.parsedAmount, l.status, l.matchedCommissionRecordId ?? '', l.notes ?? ''].join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Finvastra-Statement-${statement.providerId}-${statement.periodStart}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
