import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { InsurancePolicy, InsurancePolicyType } from '../../../types';

export function useInsurancePolicies(leadId: string | null, oppId: string | null) {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId || !oppId) { setLoading(false); return; }
    const q = query(
      collection(db, 'leads', leadId, 'opportunities', oppId, 'policies'),
      orderBy('commencementDate', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId]);

  return { policies, loading };
}

export interface AddPolicyPayload {
  policyNumber:     string;
  insurerName:      string;
  productName:      string;
  policyType:       InsurancePolicyType;
  sumAssured:       number;
  annualPremium:    number;
  premiumFrequency: 'annual' | 'semi_annual' | 'quarterly' | 'monthly';
  commencementDate: string;
  renewalDate:      string;
  status:           'active' | 'lapsed' | 'matured' | 'cancelled';
  maturityDate?:    string;
  notes?:           string;
}

export async function addInsurancePolicy(
  leadId: string,
  oppId: string,
  payload: AddPolicyPayload,
  userId: string,
): Promise<void> {
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    policyNumber:     payload.policyNumber,
    insurerName:      payload.insurerName,
    productName:      payload.productName,
    policyType:       payload.policyType,
    sumAssured:       payload.sumAssured,
    annualPremium:    payload.annualPremium,
    premiumFrequency: payload.premiumFrequency,
    commencementDate: payload.commencementDate,
    renewalDate:      payload.renewalDate,
    status:           payload.status,
    addedBy:          userId,
    addedAt:          now,
    updatedAt:        now,
  };
  if (payload.maturityDate) data.maturityDate = payload.maturityDate;
  if (payload.notes)        data.notes        = payload.notes;

  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'policies'), data);
}

export async function updateInsurancePolicy(
  leadId: string,
  oppId: string,
  policyId: string,
  updates: Partial<Omit<InsurancePolicy, 'id' | 'addedBy' | 'addedAt'>>,
): Promise<void> {
  const ref = doc(db, 'leads', leadId, 'opportunities', oppId, 'policies', policyId);
  await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}
