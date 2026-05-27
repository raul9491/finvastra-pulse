import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { WealthInvestment, WealthInvestmentType } from '../../../types';

export function useWealthInvestments(leadId: string | null, oppId: string | null) {
  const [investments, setInvestments] = useState<WealthInvestment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId || !oppId) { setLoading(false); return; }
    const q = query(
      collection(db, 'leads', leadId, 'opportunities', oppId, 'investments'),
      orderBy('purchaseDate', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setInvestments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WealthInvestment)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId]);

  return { investments, loading };
}

export interface AddInvestmentPayload {
  investmentType:  WealthInvestmentType;
  schemeName:      string;
  investedAmount:  number;
  purchaseDate:    string;
  status:          'active' | 'redeemed' | 'paused';
  folioNumber?:    string;
  sipAmount?:      number;
  units?:          number;
  purchaseNAV?:    number;
  currentNAV?:     number;
  currentValue?:   number;
  notes?:          string;
}

export async function addWealthInvestment(
  leadId: string,
  oppId: string,
  payload: AddInvestmentPayload,
  userId: string,
): Promise<void> {
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    investmentType:  payload.investmentType,
    schemeName:      payload.schemeName,
    investedAmount:  payload.investedAmount,
    purchaseDate:    payload.purchaseDate,
    status:          payload.status,
    addedBy:         userId,
    addedAt:         now,
    updatedAt:       now,
  };
  if (payload.folioNumber)  data.folioNumber  = payload.folioNumber;
  if (payload.sipAmount)    data.sipAmount    = payload.sipAmount;
  if (payload.units)        data.units        = payload.units;
  if (payload.purchaseNAV)  data.purchaseNAV  = payload.purchaseNAV;
  if (payload.currentNAV)   data.currentNAV   = payload.currentNAV;
  if (payload.currentValue) data.currentValue = payload.currentValue;
  if (payload.notes)        data.notes        = payload.notes;

  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'investments'), data);
}

export async function updateWealthInvestment(
  leadId: string,
  oppId: string,
  investmentId: string,
  updates: Partial<Omit<WealthInvestment, 'id' | 'addedBy' | 'addedAt'>>,
): Promise<void> {
  const ref = doc(db, 'leads', leadId, 'opportunities', oppId, 'investments', investmentId);
  await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}
