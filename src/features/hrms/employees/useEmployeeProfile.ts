/**
 * The reads behind an employee profile: the /users doc, the HRMS
 * employee_profiles doc (keyed by employee CODE, not uid), the admin/HR-only
 * employee_sensitive doc, and user_details.
 * 
 * Extracted verbatim from EmployeeProfilePage.tsx (2026-07-23) - no behaviour
 * change. employee_sensitive holds salary + bank and stays admin/HR-gated by
 * firestore.rules; nothing here widens that.
 */
import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { UserProfile, UserDetails, EmployeeProfile } from '../../../types';

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useEmployee(userId: string | undefined) {
  const [profile,  setProfile]  = useState<UserProfile | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    getDoc(doc(db, 'users', userId))
      .then((snap) => setProfile(snap.exists() ? (snap.data() as UserProfile) : null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId]);

  return { profile, loading };
}

export function useEmployeeProfileDoc(empCode: string | undefined) {
  const [epDoc,    setEpDoc]    = useState<EmployeeProfile | null>(null);
  const [epLoading,setEpLoading]= useState(true);

  useEffect(() => {
    if (!empCode) { setEpLoading(false); return; }
    getDoc(doc(db, 'employee_profiles', empCode))
      .then((snap) => setEpDoc(snap.exists() ? (snap.data() as EmployeeProfile) : null))
      .catch(() => setEpDoc(null))
      .finally(() => setEpLoading(false));
  }, [empCode]);

  return { epDoc, epLoading, setEpDoc };
}

export interface SensitiveData {
  bankName?: string; bankBranch?: string;
  bankAccountNo?: string; bankIfsc?: string; uan?: string;
  salaryBasic?: number; salaryHra?: number; salaryConveyance?: number;
  salaryMedical?: number; salaryOther?: number; grossSalary?: number;
}

export function useEmployeeSensitive(userId: string | undefined) {
  const [sensitive,    setSensitive]    = useState<SensitiveData | null>(null);
  const [sensLoading,  setSensLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setSensLoading(false); return; }
    getDoc(doc(db, 'employee_sensitive', userId))
      .then((snap) => setSensitive(snap.exists() ? (snap.data() as SensitiveData) : {}))
      .catch(() => setSensitive(null))
      .finally(() => setSensLoading(false));
  }, [userId]);

  return { sensitive, sensLoading, setSensitive };
}

export function useUserDetails(userId: string | undefined) {
  const [details,     setDetails]     = useState<UserDetails | null>(null);
  const [detLoading,  setDetLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setDetLoading(false); return; }
    getDoc(doc(db, 'user_details', userId))
      .then((snap) => setDetails(snap.exists() ? (snap.data() as UserDetails) : {}))
      .catch(() => setDetails(null))
      .finally(() => setDetLoading(false));
  }, [userId]);

  return { details, detLoading, setDetails };
}
