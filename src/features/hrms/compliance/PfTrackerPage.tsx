import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle, Download, FileText } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { Payslip, UserProfile, EmployeeProfile } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── PF calculation helpers ───────────────────────────────────────────────────

interface PfRow {
  userId:       string;
  empCode:      string;
  name:         string;
  uan:          string | null;
  basicSalary:  number;
  grossWages:   number;   // totalEarnings from payslip
  pfWages:      number;   // min(basicSalary, 15000)
  empContrib:   number;   // employee 12%
  epsContrib:   number;   // employer EPS — min(pfWages × 8.33%, 1250)
  epfDiff:      number;   // employer EPF diff = employer12% - EPS
  employerTotal:number;   // pfWages × 12%
  totalContrib: number;   // empContrib + employerTotal
  lopDays:      number;
}

function calcPfRow(
  payslip: Payslip,
  profile: UserProfile,
  epProfile: EmployeeProfile | null,
): PfRow {
  const pfWages      = Math.min(payslip.basicSalary, 15000);
  const empContrib   = Math.round(pfWages * 0.12);
  const epsContrib   = Math.min(Math.round(pfWages * 0.0833), 1250);
  const employerTotal= Math.round(pfWages * 0.12);
  const epfDiff      = employerTotal - epsContrib;
  return {
    userId:        payslip.employeeId,
    empCode:       profile.employeeId ?? payslip.employeeId.slice(-8),
    name:          profile.displayName,
    uan:           epProfile?.uan ?? null,
    basicSalary:   payslip.basicSalary,
    grossWages:    payslip.totalEarnings,
    pfWages,
    empContrib,
    epsContrib,
    epfDiff,
    employerTotal,
    totalContrib:  empContrib + employerTotal,
    lopDays:       payslip.lopDays,
  };
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportECR(rows: PfRow[], month: string) {
  const lines = rows.map((r) =>
    [
      r.uan ?? '',
      r.name.toUpperCase(),
      r.grossWages,
      r.pfWages,
      r.pfWages,       // EPS_WAGES same as EPF_WAGES
      r.empContrib,
      r.epsContrib,
      r.epfDiff,
      r.lopDays,
      0,               // REFUND_OF_ADVANCES
    ].join('~'),
  );
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ECR_Finvastra_${month}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSummaryCSV(rows: PfRow[], month: string) {
  const headers = [
    'Emp Code', 'Name', 'UAN', 'Basic Salary', 'PF Wages',
    'Employee PF (12%)', 'Employer EPF', 'Employer EPS',
    'Employer Total (12%)', 'Grand Total', 'LOP Days',
  ];
  const csvRows = rows.map((r) =>
    [
      r.empCode, r.name, r.uan ?? '',
      r.basicSalary, r.pfWages,
      r.empContrib, r.epfDiff, r.epsContrib,
      r.employerTotal, r.totalContrib,
      r.lopDays,
    ].join(','),
  );
  const content = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `PF_Summary_Finvastra_${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Currency formatter ───────────────────────────────────────────────────────

function fmt(n: number) { return `₹${n.toLocaleString('en-IN')}`; }

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PfTrackerPage() {
  const { profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // The guard below comes AFTER hooks. When profile is null (still loading),
  // isAdmin/isHrmsManager are false → hooks run safely with no-op behaviour.
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [rows,    setRows]    = useState<PfRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setRows([]);
      try {
        // 1. Fetch payslips for the month
        const payslipSnap = await getDocs(
          query(collection(db, 'payslips'), where('month', '==', selectedMonth)),
        );
        if (payslipSnap.empty) { if (!cancelled) setRows([]); return; }
        const payslips = payslipSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Payslip);

        // 2. Fetch all user profiles (for displayName + employeeId)
        const userSnap = await getDocs(collection(db, 'users'));
        const userMap  = new Map<string, UserProfile>();
        userSnap.docs.forEach((d) => userMap.set(d.id, d.data() as UserProfile));

        // 3. Fetch all employee_profiles (for UAN) — keyed by empCode
        const epSnap = await getDocs(collection(db, 'employee_profiles'));
        const epMap  = new Map<string, EmployeeProfile>();
        epSnap.docs.forEach((d) => epMap.set(d.id, d.data() as EmployeeProfile));

        // 4. Build PF rows
        const built: PfRow[] = [];
        for (const payslip of payslips) {
          const userProfile = userMap.get(payslip.employeeId);
          if (!userProfile) continue;
          const empCode  = userProfile.employeeId ?? '';
          const epProfile = empCode ? (epMap.get(empCode) ?? null) : null;
          built.push(calcPfRow(payslip, userProfile, epProfile));
        }
        // Sort by emp code
        built.sort((a, b) => a.empCode.localeCompare(b.empCode));
        if (!cancelled) setRows(built);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedMonth]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      empContrib:    acc.empContrib    + r.empContrib,
      employerTotal: acc.employerTotal + r.employerTotal,
      totalContrib:  acc.totalContrib  + r.totalContrib,
    }),
    { empContrib: 0, employerTotal: 0, totalContrib: 0 },
  ), [rows]);

  // ── Guard (after all hooks) ─────────────────────────────────────────────────
  // Only redirect once profile has loaded (profile !== null). When profile is
  // still null (first render), we fall through and render nothing below.
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const missingUAN = rows.filter((r) => !r.uan).length;
  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  })();

  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <PageHeader
        title="PF Tracker"
        subtitle="Employee Provident Fund contributions — auto-calculated from payslips"
        pinKey="hrms.pf-tracker"
      />

      {/* Month selector */}
      <div className="flex items-center gap-4 mb-6">
        <input type="month" value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="text-sm border border-(--shell-border) rounded-lg px-3 py-2 bg-(--glass-panel-bg) outline-none"
          style={{ color: 'var(--text-primary)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{monthLabel}</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-sm text-center py-16" style={{ color: 'var(--text-muted)' }}>Loading payslips…</div>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div className="text-center py-16 rounded-2xl border border-(--shell-border) bg-(--glass-panel-bg)">
          <FileText size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            No payslips generated for {monthLabel}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Generate payslips first in HRMS → Admin → Generate Payslips.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Employees Covered', value: rows.length, isNum: false },
              { label: 'Employee Contribution', value: fmt(totals.empContrib), isNum: false },
              { label: 'Employer Contribution', value: fmt(totals.employerTotal), isNum: false },
              { label: 'Grand Total to Deposit', value: fmt(totals.totalContrib), isNum: false },
            ].map(({ label, value }) => (
              <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4">
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* UAN warning */}
          {missingUAN > 0 && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4 text-sm"
              style={{ backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', color: '#92400E' }}>
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                <strong>{missingUAN} employee{missingUAN !== 1 ? 's' : ''}</strong> ha
                {missingUAN !== 1 ? 've' : 's'} no UAN number.
                Add UANs via Employees → Employee Profile → Edit before filing.
              </span>
            </div>
          )}

          {/* Export buttons */}
          <div className="flex items-start gap-3 mb-5">
            <div className="space-y-1">
              {missingUAN > 0 && (
                <p className="text-xs" style={{ color: '#92400E' }}>
                  ⚠ Verify all UAN numbers before uploading to EPFO unified portal.
                  Missing UANs will cause rejection of the entire file.
                </p>
              )}
              <div className="flex gap-3">
                <button onClick={() => exportECR(rows, selectedMonth)}
                  className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                  <Download size={15} />
                  Export ECR File
                </button>
                <button onClick={() => exportSummaryCSV(rows, selectedMonth)}
                  className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-(--shell-border)"
                  style={{ color: 'var(--text-primary)' }}>
                  <Download size={15} />
                  Export Summary CSV
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                    <th className={thCls} style={{ color: 'var(--text-muted)' }}>Emp Code</th>
                    <th className={thCls} style={{ color: 'var(--text-muted)' }}>Name</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>Basic Salary</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>PF Wages</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>Employee PF (12%)</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>Employer EPF</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>Employer EPS</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--text-muted)' }}>Total</th>
                    <th className={thCls} style={{ color: 'var(--text-muted)' }}>UAN</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.userId} style={{
                      borderBottom: idx < rows.length - 1 ? '1px solid var(--shell-border)' : 'none',
                    }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{r.empCode}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(r.basicSalary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {fmt(r.pfWages)}
                        {r.basicSalary > 15000 && (
                          <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>capped</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(r.empContrib)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmt(r.epfDiff)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmt(r.epsContrib)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold" style={{ color: '#C9A961' }}>{fmt(r.totalContrib)}</td>
                      <td className="px-4 py-3">
                        {r.uan ? (
                          <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{r.uan}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs" style={{ color: '#92400E' }}>
                            <AlertTriangle size={11} />
                            Missing
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals footer */}
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--shell-border)', backgroundColor: 'var(--glass-panel-bg)' }}>
                    <td colSpan={4} className="px-4 py-3 text-xs font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}>Totals</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {fmt(totals.empContrib)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {fmt(rows.reduce((s, r) => s + r.epfDiff, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {fmt(rows.reduce((s, r) => s + r.epsContrib, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-lg" style={{ color: '#C9A961' }}>
                      {fmt(totals.totalContrib)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* PF Calculation note */}
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            PF wage ceiling ₹15,000 · Employee 12% · Employer 12% split as EPS min(8.33%, ₹1,250) + EPF diff
          </p>
        </>
      )}
    </div>
  );
}
