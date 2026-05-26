import { useState, useEffect } from 'react';
import {
  collection, doc, onSnapshot, setDoc, updateDoc,
  serverTimestamp, getDocs, query, where,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  ItDeclaration, ItDeclarationStatus,
  ItDeclSection80C, ItDeclSection80D, ItDeclHra,
  ItDeclHomeLoan, ItDeclLta, ItDeclSection80E,
} from '../../../types';

// ─── Tax constants (Indian Income Tax Act) ────────────────────────────────────

export const MAX_80C              = 150_000;
export const MAX_80D_SELF         = 25_000;
export const MAX_80D_PARENTS      = 25_000;
export const MAX_80D_PARENTS_SR   = 50_000;   // senior citizens (60+)
export const MAX_HOME_LOAN_INT    = 200_000;  // Section 24(b)
export const TAX_RATE_ESTIMATE    = 0.30;     // indicative 30% bracket

// ─── Financial year helpers ──────────────────────────────────────────────────
// April → March; year stored as start year (2025 = FY 2025-26).

export function currentFinancialYear(): number {
  const d = new Date();
  return (d.getMonth() + 1) >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(year: number): string {
  return `FY ${year}-${String(year + 1).slice(2)}`;
}

// ─── Deterministic tax computations (pure functions) ─────────────────────────

export function compute80C(c: ItDeclSection80C): number {
  const raw = c.lifeInsurance + c.ppf + c.elss + c.nsc +
    c.homeLoanPrincipal + c.tuitionFees + c.epfVoluntary +
    c.nps80CCD1 + c.other80C;
  return Math.min(raw, MAX_80C);
}

export function compute80D(d: ItDeclSection80D): number {
  return (
    Math.min(d.selfFamilyPremium, MAX_80D_SELF) +
    Math.min(d.parentsPremium, d.parentsSenior ? MAX_80D_PARENTS_SR : MAX_80D_PARENTS)
  );
}

export function computeTotalDeductions(
  c80C: number,
  c80D: number,
  hl: ItDeclHomeLoan,
  edu: ItDeclSection80E,
  lta: ItDeclLta,
): number {
  return (
    c80C +
    c80D +
    (hl.claimingHomeLoan  ? Math.min(hl.annualInterest, MAX_HOME_LOAN_INT) : 0) +
    (edu.claimingEducationLoan ? edu.annualInterest : 0) +
    (lta.claimingLta ? lta.travelAmount : 0)
  );
}

export function computeTaxSaving(totalDeductions: number): number {
  return Math.round(totalDeductions * TAX_RATE_ESTIMATE);
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export function default80C(): ItDeclSection80C {
  return {
    lifeInsurance: 0, ppf: 0, elss: 0, nsc: 0,
    homeLoanPrincipal: 0, tuitionFees: 0, epfVoluntary: 0,
    nps80CCD1: 0, other80C: 0, total80C: 0,
  };
}
export function default80D(): ItDeclSection80D {
  return { selfFamilyPremium: 0, parentsPremium: 0, parentsSenior: false, total80D: 0 };
}
export function defaultHra(): ItDeclHra {
  return { claimingHra: false, monthlyRent: 0, landlordName: '', landlordPan: null, cityType: 'non_metro', annualRent: 0 };
}
export function defaultHomeLoan(): ItDeclHomeLoan {
  return { claimingHomeLoan: false, annualInterest: 0, propertyAddress: '', lenderName: '' };
}
export function defaultLta(): ItDeclLta {
  return { claimingLta: false, travelAmount: 0, travelDetails: '' };
}
export function default80E(): ItDeclSection80E {
  return { claimingEducationLoan: false, annualInterest: 0 };
}

// ─── Employee: live subscription to own declaration ───────────────────────────

export function useMyItDeclaration(uid: string, year: number) {
  const [declaration, setDeclaration] = useState<ItDeclaration | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const docId = `${uid}_${year}`;
    return onSnapshot(
      doc(db, 'it_declarations', docId),
      (snap) => {
        setDeclaration(snap.exists() ? { id: snap.id, ...snap.data() } as ItDeclaration : null);
        setLoading(false);
      },
      (err) => {
        console.error('[useMyItDeclaration]', err.code, err.message);
        setLoading(false);
      },
    );
  }, [uid, year]);

  return { declaration, loading };
}

// ─── Admin: count of 'submitted' declarations (for nav badge) ─────────────────
// Single-field query — no composite index needed.

export function usePendingItDeclarationCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'it_declarations'), where('status', '==', 'submitted')),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

// ─── Admin: all declarations (filtered by year client-side) ──────────────────

export function useAllItDeclarations(year: number) {
  const [declarations, setDeclarations] = useState<ItDeclaration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'it_declarations'),
      (snap) => {
        setDeclarations(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ItDeclaration)
            .filter((d) => d.year === year),
        );
        setLoading(false);
      },
      (err) => {
        console.error('[useAllItDeclarations]', err.code, err.message);
        setLoading(false);
      },
    );
  }, [year]);

  return { declarations, loading };
}

// ─── Employee: save / submit ──────────────────────────────────────────────────

export interface ItDeclFormData {
  section80C: ItDeclSection80C;
  section80D: ItDeclSection80D;
  hra:        ItDeclHra;
  homeLoan:   ItDeclHomeLoan;
  lta:        ItDeclLta;
  section80E: ItDeclSection80E;
}

export async function saveItDeclaration(
  uid:      string,
  year:     number,
  form:     ItDeclFormData,
  status:   'draft' | 'submitted',
  existing: ItDeclaration | null,
): Promise<void> {
  // Recompute derived totals before saving — deterministic, server-independent
  const total80C = compute80C(form.section80C);
  const total80D = compute80D(form.section80D);
  const totalDeductions = computeTotalDeductions(
    total80C, total80D, form.homeLoan, form.section80E, form.lta,
  );
  const estimatedTaxSaving = computeTaxSaving(totalDeductions);

  const payload: Record<string, unknown> = {
    ...form,
    section80C:   { ...form.section80C, total80C },
    section80D:   { ...form.section80D, total80D },
    hra:          { ...form.hra, annualRent: form.hra.monthlyRent * 12 },
    totalDeductions,
    estimatedTaxSaving,
    status,
    updatedAt: serverTimestamp(),
    reopenRequested: false,
  };

  const docId  = `${uid}_${year}`;
  const docRef = doc(db, 'it_declarations', docId);

  if (!existing) {
    await setDoc(docRef, {
      employeeId: uid,
      year,
      submittedAt:  status === 'submitted' ? serverTimestamp() : null,
      acceptedBy:   null,
      acceptedAt:   null,
      revisionNote: null,
      ...payload,
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(docRef, {
      ...payload,
      submittedAt: status === 'submitted' && !existing.submittedAt
        ? serverTimestamp()
        : existing.submittedAt ?? null,
    });
  }
}

// ─── Admin mutations ──────────────────────────────────────────────────────────

export async function acceptItDeclaration(
  employeeId: string,
  year:       number,
  adminUid:   string,
): Promise<void> {
  await updateDoc(doc(db, 'it_declarations', `${employeeId}_${year}`), {
    status:     'accepted' as ItDeclarationStatus,
    acceptedBy: adminUid,
    acceptedAt: serverTimestamp(),
    updatedAt:  serverTimestamp(),
  });
}

export async function requestItRevision(
  employeeId: string,
  year:       number,
  note:       string,
): Promise<void> {
  await updateDoc(doc(db, 'it_declarations', `${employeeId}_${year}`), {
    status:         'draft' as ItDeclarationStatus,
    reopenRequested: false,
    revisionNote:    note || null,
    acceptedBy:      null,
    acceptedAt:      null,
    updatedAt:       serverTimestamp(),
  });
}

// ─── Employee: request reopen (HR sees flag in admin panel) ──────────────────

export async function requestItReopen(employeeId: string, year: number): Promise<void> {
  await updateDoc(doc(db, 'it_declarations', `${employeeId}_${year}`), {
    reopenRequested: true,
    updatedAt:       serverTimestamp(),
  });
}

// ─── Admin: CSV export (CA-friendly) ─────────────────────────────────────────

export async function exportItDeclarationsCSV(
  year:      number,
  employees: Array<{ userId: string; displayName: string; empCode?: string; department?: string }>,
): Promise<void> {
  const snap = await getDocs(collection(db, 'it_declarations'));
  const decls = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as ItDeclaration)
    .filter((d) => d.year === year);

  if (decls.length === 0) {
    alert(`No IT declarations found for ${fyLabel(year)}.`);
    return;
  }

  const empMap = new Map(employees.map((e) => [e.userId, e]));

  const header = [
    'EmpCode', 'Name', 'Department', 'Status',
    '80C Total (₹)', '80D Total (₹)',
    'HRA Claimed', 'Home Loan Interest (₹)',
    'Education Loan Interest (₹)', 'LTA (₹)',
    'Total Deductions (₹)', 'Estimated Tax Saving (₹)',
    'Submitted On',
  ].join(',');

  const rows = decls.map((d) => {
    const emp = empMap.get(d.employeeId);
    const hlDeduction = d.homeLoan.claimingHomeLoan
      ? Math.min(d.homeLoan.annualInterest, MAX_HOME_LOAN_INT) : 0;
    const submitted = d.submittedAt
      ? (() => { try { return (d.submittedAt as any).toDate().toLocaleDateString('en-IN'); } catch { return ''; } })()
      : '';
    return [
      emp?.empCode ?? '',
      emp?.displayName ?? d.employeeId,
      emp?.department ?? '',
      d.status,
      d.section80C.total80C,
      d.section80D.total80D,
      d.hra.claimingHra ? 'Yes' : 'No',
      hlDeduction,
      d.section80E.claimingEducationLoan ? d.section80E.annualInterest : 0,
      d.lta.claimingLta ? d.lta.travelAmount : 0,
      d.totalDeductions,
      d.estimatedTaxSaving,
      submitted,
    ].join(',');
  });

  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `IT_Declarations_${fyLabel(year).replace(' ', '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
