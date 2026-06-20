import { useEffect, useState } from 'react';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  Connector, ConnectorVertical, ConnectorPayout,
} from '../../../types';

// ─── Connectors list ──────────────────────────────────────────────────────────

export function useConnectors(enabled = true) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'connectors'),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Connector)
          .filter((c) => !c.deleted)
          .sort((a, b) => a.connectorCode.localeCompare(b.connectorCode));
        setConnectors(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [enabled]);

  return { connectors, loading };
}

// Next FAC-### code from the existing set (client-side; fine at this scale).
// Connectors are coded CONN-### (legacy ones were FAC-### — both are counted so
// the next number never collides; a one-time migration renames FAC- → CONN-).
export function nextConnectorCode(connectors: Connector[]): string {
  let max = 0;
  for (const c of connectors) {
    const m = /^(?:CONN|FAC)-(\d+)$/.exec(c.connectorCode ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CONN-${String(max + 1).padStart(3, '0')}`;
}

// ─── Mutations ──────────────────────────────────────────────────────────────
// Connectors are managed in ONE place: CRM → Admin → Masters → Connectors.
// The FAC-### code is auto-assigned (never client-editable). The main record
// is all there is — there is no PAN/bank financial sub-doc anymore.

export interface MasterConnectorInput {
  displayName: string;
  mobile: string;
  email?: string;
  firmName?: string;
  verticals: ConnectorVertical[];
  status?: Connector['status'];
}

export async function addMasterConnector(
  input: MasterConnectorInput,
  connectorCode: string,
  uid: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'connectors'), {
    connectorCode,
    displayName: input.displayName.trim(),
    mobile:      input.mobile.trim(),
    email:       input.email?.trim() || '',
    address:     '',
    firmName:    input.firmName?.trim() || null,
    ownDsaCode:  null,
    verticals:   input.verticals,
    status:      input.status ?? 'active',
    notes:       null,
    deleted:     false,
    createdBy:   uid,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
  return ref.id;
}

export async function updateMasterConnector(
  id: string,
  input: MasterConnectorInput,
): Promise<void> {
  await updateDoc(doc(db, 'connectors', id), {
    displayName: input.displayName.trim(),
    mobile:      input.mobile.trim(),
    email:       input.email?.trim() || '',
    firmName:    input.firmName?.trim() || null,
    verticals:   input.verticals,
    ...(input.status ? { status: input.status } : {}),
    updatedAt:   serverTimestamp(),
  });
}

export async function setConnectorStatus(id: string, status: Connector['status']): Promise<void> {
  await updateDoc(doc(db, 'connectors', id), { status, updatedAt: serverTimestamp() });
}

// Soft-delete — keeps payout history intact while removing from pickers/lists.
export async function deleteConnector(id: string): Promise<void> {
  await updateDoc(doc(db, 'connectors', id), {
    deleted: true, status: 'inactive', updatedAt: serverTimestamp(),
  });
}

// ─── Payouts ────────────────────────────────────────────────────────────────

export function useConnectorPayouts(connectorId?: string) {
  const [payouts, setPayouts] = useState<ConnectorPayout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectorId) { setPayouts([]); setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'connector_payouts'),
      where('connectorId', '==', connectorId),
    );
    const unsub = onSnapshot(q, (snap) => {
      // Sort client-side (newest first) to avoid a composite index.
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConnectorPayout)
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setPayouts(rows);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [connectorId]);

  return { payouts, loading };
}

export async function addConnectorPayout(
  connector: Connector,
  data: { businessLine: ConnectorVertical; caseLabel: string; amount: number; notes?: string; leadId?: string; opportunityId?: string },
  uid: string,
): Promise<void> {
  await addDoc(collection(db, 'connector_payouts'), {
    connectorId:   connector.id,
    connectorCode: connector.connectorCode,
    connectorName: connector.displayName,
    businessLine:  data.businessLine,
    caseLabel:     data.caseLabel,
    amount:        data.amount,
    status:        'pending',
    notes:         data.notes || null,
    leadId:        data.leadId || null,
    opportunityId: data.opportunityId || null,
    createdBy:     uid,
    createdAt:     serverTimestamp(),
  });
}

export async function markConnectorPayoutPaid(
  id: string, uid: string, paymentReference: string,
): Promise<void> {
  await updateDoc(doc(db, 'connector_payouts', id), {
    status: 'paid',
    paidAt: serverTimestamp(),
    paidBy: uid,
    paymentReference: paymentReference || null,
  });
}
