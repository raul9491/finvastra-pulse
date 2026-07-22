/**
 * Data hooks for the connector (channel-partner) self-service area.
 *
 * Leads / cases / payouts are read STRAIGHT FROM FIRESTORE with a live listener —
 * firestore.rules already scopes each of those collections to
 * `channelPartnerId == the caller's own CON- id`, so the query below is a
 * convenience, not the security boundary (proved by .qa/connector-isolation-gate).
 *
 * The one thing NOT read directly is the partner's own KYC/bank: that doc holds
 * the ENCRYPTED PAN and account number, so it stays admin/HR-only in the rules and
 * the last-4 come from GET /api/crm2/partner/me, which strips the ciphertext.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { apiCrm2 } from '../crm2/lib';
import { useAuth } from '../auth/AuthContext';

export interface PartnerMe {
  connector: {
    id: string; connectorCode: string; displayName: string | null; firmName: string | null;
    entityType: string | null; mobile: string | null; mobiles: string[]; email: string | null;
    verticals: string[]; status: string | null; funnelStatus: string | null; gstin: string | null;
  };
  kyc: { panLast4: string | null; aadhaarLast4: string | null };
  bank: {
    bankName: string | null; accountHolderName: string | null; ifsc: string | null;
    accountNoLast4: string | null; branchName: string | null;
  };
  tdsPct: number | null;
}

export interface PartnerSummary {
  connectorId: string;
  leads: { total: number; converted: number };
  cases: { total: number; open: number; completed: number };
  payouts: { pending: number; paid: number; total: number; count: number };
}

/** The signed-in user's own CON- id (null for staff). */
export function useMyConnectorId(): string | null {
  const { profile } = useAuth();
  return (profile?.connectorId as string | null | undefined) ?? null;
}

export function usePartnerMe() {
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    apiCrm2<PartnerMe>('GET', '/api/crm2/partner/me')
      .then((d) => { if (alive) { setMe(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : 'Could not load your details'); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  return { me, loading, error };
}

export function usePartnerSummary(refreshKey = 0) {
  const [summary, setSummary] = useState<PartnerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiCrm2<PartnerSummary>('GET', '/api/crm2/partner/summary')
      .then((d) => { if (alive) { setSummary(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey]);
  return { summary, loading };
}

type Row = Record<string, unknown> & { id: string };

/** Live rows from a collection, pinned to the caller's own connector id. */
function useOwnRows(coll: string, field: string, connectorId: string | null) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!connectorId) { setRows([]); setLoading(false); return; }
    const q = query(collection(db, coll), where(field, '==', connectorId));
    const unsub = onSnapshot(q,
      (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Row)); setLoading(false); },
      () => setLoading(false));
    return unsub;
  }, [coll, field, connectorId]);
  return { rows, loading };
}

export function useMyLeads(connectorId: string | null) {
  const { rows, loading } = useOwnRows('leads', 'channelPartnerId', connectorId);
  return { leads: rows.filter((r) => r.deleted !== true), loading };
}
export function useMyCases(connectorId: string | null) {
  const { rows, loading } = useOwnRows('cases', 'channelPartnerId', connectorId);
  return { cases: rows, loading };
}
export function useMyPayouts(connectorId: string | null) {
  const { rows, loading } = useOwnRows('connector_payouts', 'connectorId', connectorId);
  return { payouts: rows, loading };
}
