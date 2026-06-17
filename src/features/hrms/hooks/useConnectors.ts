import { useEffect, useState } from 'react';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, setDoc, getDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  Connector, ConnectorFinancial, ConnectorBankDetails, ConnectorVertical,
  ConnectorPayout,
} from '../../../types';

// ─── Connectors list ──────────────────────────────────────────────────────────

export function useConnectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return { connectors, loading };
}

// Next FAC-### code from the existing set (client-side; fine at this scale).
export function nextConnectorCode(connectors: Connector[]): string {
  let max = 0;
  for (const c of connectors) {
    const m = /^FAC-(\d+)$/.exec(c.connectorCode ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FAC-${String(max + 1).padStart(3, '0')}`;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface ConnectorInput {
  connectorCode: string;
  displayName: string;
  mobile: string;
  email: string;
  address: string;
  firmName?: string;
  ownDsaCode?: string;          // the connector's OWN bank DSA code, if they have one
  verticals: ConnectorVertical[];
  payoutRules?: Connector['payoutRules'];   // per-product CRM 2.0 auto-payout rules
  status: Connector['status'];
  notes?: string;
}

export async function createConnector(
  input: ConnectorInput,
  financial: { pan: string; bank: ConnectorBankDetails },
  uid: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'connectors'), {
    ...input,
    firmName:    input.firmName || null,
    ownDsaCode:  input.ownDsaCode || null,
    payoutRules: input.payoutRules ?? [],
    notes:       input.notes || null,
    deleted:  false,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'connectors', ref.id, 'private', 'financial'), {
    pan:  financial.pan,
    bank: financial.bank,
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateConnector(
  id: string,
  input: ConnectorInput,
  financial: { pan: string; bank: ConnectorBankDetails },
): Promise<void> {
  await updateDoc(doc(db, 'connectors', id), {
    ...input,
    firmName:    input.firmName || null,
    ownDsaCode:  input.ownDsaCode || null,
    payoutRules: input.payoutRules ?? [],
    notes:       input.notes || null,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'connectors', id, 'private', 'financial'), {
    pan:  financial.pan,
    bank: financial.bank,
    updatedAt: serverTimestamp(),
  });
}

// ─── Quick-add from CRM ─────────────────────────────────────────────────────
// CRM users can register a connector on the spot when a new channel partner
// walks in with a case — main record only. PAN + bank details (the /private
// financial sub-doc) stay admin/HR-only and are completed later in
// HRMS → Connectors before any payout is made.
export interface QuickConnectorInput {
  displayName: string;
  mobile: string;
  email?: string;
  firmName?: string;
  ownDsaCode?: string;
  verticals: ConnectorVertical[];
}

export async function quickAddConnector(
  input: QuickConnectorInput,
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
    ownDsaCode:  input.ownDsaCode?.trim() || null,
    verticals:   input.verticals,
    status:      'active',
    notes:       'Added from CRM — HR to complete PAN/bank details before payout.',
    deleted:     false,
    createdBy:   uid,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
  return ref.id;
}

export async function getConnectorFinancial(id: string): Promise<ConnectorFinancial | null> {
  const snap = await getDoc(doc(db, 'connectors', id, 'private', 'financial'));
  return snap.exists() ? (snap.data() as ConnectorFinancial) : null;
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
