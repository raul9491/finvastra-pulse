import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

interface ExpiryResult {
  expiredCount: number;
  soonToExpireCount: number; // expires within 14 days
}

export function useDocumentExpiry(
  documentStatus: Record<string, string> | undefined,
  documentStatusLog: Array<{ docTypeId: string; to: string; at: string }> | undefined,
): ExpiryResult {
  const [expiryDays, setExpiryDays] = useState<Map<string, number | null>>(new Map());

  useEffect(() => {
    return onSnapshot(collection(db, 'document_types'), (snap) => {
      const map = new Map<string, number | null>();
      snap.docs.forEach(d => {
        const data = d.data();
        map.set(d.id, typeof data.expiryDays === 'number' ? data.expiryDays : null);
      });
      setExpiryDays(map);
    });
  }, []);

  return useMemo(() => {
    if (!documentStatus) return { expiredCount: 0, soonToExpireCount: 0 };
    const now = Date.now();
    let expiredCount = 0, soonToExpireCount = 0;

    for (const [docTypeId, status] of Object.entries(documentStatus)) {
      if (status === 'expired') {
        expiredCount++;
        continue;
      }
      if (status !== 'collected' && status !== 'submitted') continue;

      const days = expiryDays.get(docTypeId);
      if (!days) continue; // null or 0 = never expires

      const log = (documentStatusLog ?? [])
        .filter(e => e.docTypeId === docTypeId && e.to === 'collected')
        .sort((a, b) => b.at.localeCompare(a.at));
      if (log.length === 0) continue;

      const collectedAt = new Date(log[0].at).getTime();
      const expiresAt = collectedAt + days * 86400000;

      if (now > expiresAt) {
        expiredCount++;
      } else if (expiresAt - now < 14 * 86400000) {
        soonToExpireCount++;
      }
    }

    return { expiredCount, soonToExpireCount };
  }, [documentStatus, documentStatusLog, expiryDays]);
}
