/**
 * ClaimsAnalyticsPage — spend analysis over claims, by the bill's actual date
 * (`expenseDate`, falling back to submission date) so a full year can be analysed.
 *
 * Breakdowns: by category, by month, by employee. "Spend basis" toggles between
 * settled spend (approved + paid) and everything claimed (excl. rejected).
 * Pure client-side aggregation of `useAllClaims()` — no new infra.
 * Admin / HR manager only.
 */
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Car, Smartphone, Heart, Fuel, Users, HelpCircle, CreditCard, Laptop, Package,
  Download, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllClaims } from '../hooks/useClaims';
import type { ClaimType, Claim } from '../../../types';

const CATEGORY_META: Record<ClaimType, { label: string; icon: typeof Car; color: string }> = {
  travel:               { label: 'Travel',               icon: Car,        color: '#3B82F6' },
  mobile:               { label: 'Mobile',               icon: Smartphone, color: '#8B5CF6' },
  medical:              { label: 'Medical',              icon: Heart,      color: '#EF4444' },
  petrol:               { label: 'Petrol',               icon: Fuel,       color: '#F59E0B' },
  client_entertainment: { label: 'Client Entertainment', icon: Users,      color: '#10B981' },
  cibil:                { label: 'CIBIL',                icon: CreditCard, color: '#06B6D4' },
  software:             { label: 'Software',             icon: Laptop,     color: '#6366F1' },
  office_supplies:      { label: 'Office Supplies',      icon: Package,    color: '#F97316' },
  other:                { label: 'Other',                icon: HelpCircle, color: 'var(--text-muted)' },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtShort = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${Math.round(n / 1e3)}k` : `₹${Math.round(n)}`);

// The date a claim's spend belongs to: the bill date if recorded, else submission.
function claimDate(c: Claim): Date | null {
  if (c.expenseDate) { const d = new Date(c.expenseDate); if (!isNaN(d.getTime())) return d; }
  const s = c.submittedAt as unknown as { toDate?: () => Date };
  return s?.toDate ? s.toDate() : null;
}

type Basis = 'settled' | 'all';

export function ClaimsAnalyticsPage() {
  const { profile } = useAuth();
  const { claims, loading } = useAllClaims();
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [basis, setBasis] = useState<Basis>('settled');

  const years = useMemo(() => {
    const set = new Set<number>([nowYear]);
    claims.forEach((c) => { const d = claimDate(c); if (d) set.add(d.getFullYear()); });
    return [...set].sort((a, b) => b - a);
  }, [claims, nowYear]);

  const data = useMemo(() => {
    const inYear = claims.filter((c) => {
      const d = claimDate(c);
      return d && d.getFullYear() === year && c.status !== 'rejected';
    });
    const spend = basis === 'settled'
      ? inYear.filter((c) => c.status === 'approved' || c.status === 'paid')
      : inYear;

    const sum = (arr: Claim[]) => arr.reduce((s, c) => s + (c.amount || 0), 0);
    const totals = {
      total:    sum(spend),
      approved: sum(inYear.filter((c) => c.status === 'approved')),
      paid:     sum(inYear.filter((c) => c.status === 'paid')),
      pending:  sum(inYear.filter((c) => c.status === 'pending')),
      count:    spend.length,
    };

    const byCat = new Map<ClaimType, { amount: number; count: number }>();
    spend.forEach((c) => { const e = byCat.get(c.claimType) ?? { amount: 0, count: 0 }; e.amount += c.amount; e.count++; byCat.set(c.claimType, e); });
    const categories = [...byCat.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.amount - a.amount);
    const maxCat = Math.max(1, ...categories.map((c) => c.amount));

    const months = Array.from({ length: 12 }, () => 0);
    spend.forEach((c) => { const d = claimDate(c); if (d) months[d.getMonth()] += c.amount; });
    const maxMonth = Math.max(1, ...months);

    const byEmp = new Map<string, { name: string; amount: number; count: number }>();
    spend.forEach((c) => { const e = byEmp.get(c.employeeId) ?? { name: c.employeeName, amount: 0, count: 0 }; e.amount += c.amount; e.count++; byEmp.set(c.employeeId, e); });
    const employees = [...byEmp.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
    const maxEmp = Math.max(1, ...employees.map((e) => e.amount));

    return { totals, categories, maxCat, months, maxMonth, employees, maxEmp, rows: spend };
  }, [claims, year, basis]);

  if (!(profile?.role === 'admin' || profile?.isHrmsManager)) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const exportCsv = () => {
    const header = 'Employee,Category,Amount,Status,Bill Date,Description';
    const rows = data.rows.map((c) => {
      const d = claimDate(c);
      const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      return [esc(c.employeeName), CATEGORY_META[c.claimType]?.label ?? c.claimType, c.amount,
        c.status, d ? d.toISOString().slice(0, 10) : '', esc(c.description)].join(',');
    });
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `claims-spend-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const t = data.totals;
  const avg = t.count > 0 ? t.total / t.count : 0;

  const Card = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
    <div className="glass-panel p-4" style={{ borderLeft: `3px solid ${accent ?? '#C9A961'}` }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Claims Spend Analytics
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>By the bill date — where the money actually went, this year.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="text-sm border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gold/30 text-(--text-primary) border-(--shell-border) bg-(--glass-panel-bg)">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--shell-border)' }}>
            {([['settled', 'Approved + Paid'], ['all', 'All claimed']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setBasis(k)} className="text-xs font-semibold px-3 py-2 transition-colors"
                style={{ backgroundColor: basis === k ? '#C9A961' : 'var(--glass-panel-bg)', color: basis === k ? '#0B1538' : 'var(--text-muted)' }}>
                {lbl}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20">
          <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
        </div>
      ) : t.count === 0 ? (
        <div className="glass-panel p-12 text-center">
          <TrendingUp size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No spend recorded for {year}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Try another year, or switch to "All claimed".</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card label={basis === 'settled' ? 'Settled spend' : 'Total claimed'} value={fmtINR(t.total)} sub={`${t.count} claims`} />
            <Card label="Avg / claim" value={fmtINR(avg)} accent="#3B82F6" />
            <Card label="Paid out" value={fmtINR(t.paid)} accent="#10B981" />
            <Card label="Pending" value={fmtINR(t.pending)} accent="#F59E0B" sub="awaiting action" />
          </div>

          {/* By category */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>By category</h3>
            <div className="space-y-3">
              {data.categories.map(({ key, amount, count }) => {
                const m = CATEGORY_META[key] ?? CATEGORY_META.other;
                const Icon = m.icon;
                const pct = Math.round((amount / t.total) * 100);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: m.color + '22', color: m.color }}>
                      <Icon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.label}</span>
                        <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>{fmtINR(amount)} <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>· {pct}% · {count}</span></span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(amount / data.maxCat) * 100}%`, backgroundColor: m.color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By month */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>By month ({year})</h3>
            <div className="flex items-end justify-between gap-1.5" style={{ height: 160 }}>
              {data.months.map((amt, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 group" style={{ height: '100%' }}>
                  <span className="text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{amt > 0 ? fmtShort(amt) : ''}</span>
                  <div className="w-full rounded-t-md transition-all" title={fmtINR(amt)}
                    style={{ height: `${Math.max(amt > 0 ? 3 : 0, (amt / data.maxMonth) * 100)}%`, backgroundColor: amt > 0 ? '#C9A961' : 'transparent', minHeight: amt > 0 ? 4 : 0 }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{MONTH_NAMES[i]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top employees */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Top spenders</h3>
            <div className="space-y-2.5">
              {data.employees.map((e) => (
                <div key={e.name} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{e.name}</span>
                      <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>{fmtINR(e.amount)} <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>· {e.count}</span></span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(e.amount / data.maxEmp) * 100}%`, backgroundColor: '#9A7E3F' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
