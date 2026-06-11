import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { PageShare, ShareableModule } from '../../../types';
import type { PageKey } from '../../../config/shareablePages';

export interface MyShares {
  shares: PageShare[];
  sharesByModule: Record<ShareableModule, PageShare[]>;
  hasShareFor: (pageKey: PageKey | string | null) => boolean;
  loading: boolean;
}

const EMPTY_BY_MODULE: Record<ShareableModule, PageShare[]> = { crm: [], hrms: [], mis: [] };

/**
 * Live subscription to the caller's ACTIVE page shares.
 * Two equality filters → no composite index required.
 *
 * IMPORTANT (route-guard race): consumers must not redirect away while
 * `loading` is true — on a hard refresh the share snapshot arrives after auth.
 */
export function useMyShares(uid: string | null | undefined): MyShares {
  const [shares, setShares] = useState<PageShare[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setShares([]); setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'page_shares'),
      where('grantedTo', '==', uid),
      where('active', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      setShares(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageShare));
      setLoading(false);
    }, () => { setShares([]); setLoading(false); });
    return unsub;
  }, [uid]);

  const sharesByModule = useMemo(() => {
    if (shares.length === 0) return EMPTY_BY_MODULE;
    const by: Record<ShareableModule, PageShare[]> = { crm: [], hrms: [], mis: [] };
    for (const s of shares) if (by[s.module]) by[s.module].push(s);
    return by;
  }, [shares]);

  const keys = useMemo(() => new Set(shares.map((s) => s.pageKey)), [shares]);

  return {
    shares,
    sharesByModule,
    hasShareFor: (pageKey) => pageKey != null && keys.has(pageKey),
    loading,
  };
}
