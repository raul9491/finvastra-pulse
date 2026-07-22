/**
 * AdminSalaryHistoryPage — View and record salary revisions for all employees.
 * Path: /hrms/admin/salary-history    Access: admin + isHrmsManager
 *
 * - Full timeline of salary changes across the org
 * - Record new revision (joining CTC, annual increment, promotion, correction)
 * - Filter by employee; search by name
 * - Auto-computes increment % when previous salary available
 * - Downloadable as CSV (for CA / payroll)
 */

import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { TrendingUp, Plus, X, Search, Download, ArrowUpRight } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllSalaryHistory, useEmployeeSalaryHistory, recordSalaryRevision } from '../hooks/useSalaryHistory';
import type { SalaryRevisionReason } from '../../../types';
import { SALARY_REVISION_REASON_LABELS } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REASON_COLOR: Record<SalaryRevisionReason, { color: string; bg: string }> = {
  joining:          { color: '#065F46', bg: '#D1FAE5' },
  increment:        { color: '#0369A1', bg: '#E0F2FE' },
  promotion:        { color: '#4C1D95', bg: '#EDE9FE' },
  correction:       { color: '#374151', bg: '#F3F4F6' },
  contract_renewal: { color: '#B45309', bg: '#FEF3C7' },
  other:            { color: 'var(--text-muted)', bg: '#F9FAFB'  },
};

function ReasonPill({ reason }: { reason: SalaryRevisionReason }) {
  const m = REASON_COLOR[reason];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.bg }}>
      {SALARY_REVISION_REASON_LABELS[reason]}
    </span>
  );
}

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// ── Employee Salary Timeline (detail drawer) ──────────────────────────────────

function EmployeeTimeline({
  employeeId,
  employeeName,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { records, loading } = useEmployeeSalaryHistory(employeeId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end p-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) h-full w-full max-w-md overflow-y-auto flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border) shrink-0">
          <div>
            <h2 className="text-base font-semibold">{employeeName}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Salary history</p>
          </div>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>
        <div className="flex-1 p-6">
          {loading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : records.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No salary records yet for this employee.</p>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-3 top-2 bottom-2 w-px bg-(--shell-hover-hard)" />
              <div className="space-y-6">
                {records.map((r, i) => (
                  <div key={r.id} className="flex gap-4">
                    {/* Dot */}
                    <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 relative z-10"
                      style={{ backgroundColor: i === 0 ? '#0B1538' : 'var(--shell-hover-soft)', borderColor: i === 0 ? '#0B1538' : 'var(--shell-border-mid)' }}>
                      {i === 0 && <div className="w-2 h-2 rounded-full bg-(--glass-panel-bg)" />}
                    </div>
                    {/* Content */}
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {fmtINR(r.grossSalary)}<span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>/mo</span>
                        </span>
                        {r.incrementPercentage != null && (
                          <span className="text-[10px] font-bold flex items-center gap-0.5"
                            style={{ color: '#059669' }}>
                            <ArrowUpRight size={10} />{r.incrementPercentage.toFixed(1)}%
                          </span>
                        )}
                        <ReasonPill reason={r.reason} />
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Effective {format(new Date(r.effectiveDate), 'd MMM yyyy')}
                      </p>
                      {r.notes && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>{r.notes}</p>}
                      {r.basicSalary != null && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          Basic {fmtINR(r.basicSalary)} · HRA {fmtINR(r.hra ?? 0)} · Other {fmtINR(r.otherAllowances ?? 0)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Revision Modal ────────────────────────────────────────────────────────

interface RevForm {
  employeeId: string;
  effectiveDate: string;
  grossSalary: string;
  basicSalary: string;
  hra: string;
  otherAllowances: string;
  reason: SalaryRevisionReason;
  notes: string;
}

const BLANK_FORM: RevForm = {
  employeeId: '', effectiveDate: '', grossSalary: '',
  basicSalary: '', hra: '', otherAllowances: '',
  reason: 'increment', notes: '',
};

function AddRevisionModal({
  employees,
  previousSalaries,
  onClose,
  onSave,
}: {
  employees: { uid: string; displayName: string }[];
  previousSalaries: Map<string, number>;
  onClose: () => void;
  onSave: (f: RevForm, prevGross: number | null, incPct: number | null) => Promise<void>;
}) {
  const [form,   setForm]   = useState<RevForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [empSearch, setEmpSearch] = useState('');

  const set = <K extends keyof RevForm>(k: K, v: RevForm[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const prevGross  = form.employeeId ? (previousSalaries.get(form.employeeId) ?? null) : null;
  const newGross   = form.grossSalary ? Number(form.grossSalary) : null;
  const incPct     = prevGross && newGross && prevGross > 0
    ? Math.round(((newGross - prevGross) / prevGross) * 1000) / 10
    : null;

  const filteredEmps = employees.filter((e) =>
    e.displayName.toLowerCase().includes(empSearch.toLowerCase()),
  );

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!form.employeeId)          errs.employeeId    = 'Select an employee';
    if (!form.effectiveDate)       errs.effectiveDate = 'Required';
    if (!form.grossSalary || isNaN(Number(form.grossSalary)) || Number(form.grossSalary) <= 0)
                                   errs.grossSalary   = 'Enter a valid amount';
    if (Object.keys(errs).length)  { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form, prevGross, incPct); onClose(); }
    catch { setSaving(false); }
  };

  const inp = (f?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors ${
      f && errors[f] ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                      : 'border-(--shell-border) focus:ring-[#0B1538]'}`;

  const lbl = (text: string, f?: string, req = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: f && errors[f] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{req && <span className="text-red-500 ml-0.5">*</span>}
      {f && errors[f] && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {errors[f]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold">Record Salary Revision</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Employee */}
          <div>
            {lbl('Employee', 'employeeId', true)}
            <input className="w-full text-sm px-3.5 py-2 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] mb-1"
              placeholder="Search…" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            <select className={inp('employeeId')} value={form.employeeId}
              onChange={(e) => set('employeeId', e.target.value)} size={4}>
              {filteredEmps.map((e) => (
                <option key={e.uid} value={e.uid}>{e.displayName}</option>
              ))}
            </select>
            {prevGross && (
              <p className="text-xs mt-1 font-medium" style={{ color: '#0369A1' }}>
                Current salary on record: {fmtINR(prevGross)}/mo
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              {lbl('Effective Date', 'effectiveDate', true)}
              <input type="date" className={inp('effectiveDate')} value={form.effectiveDate}
                onChange={(e) => set('effectiveDate', e.target.value)} />
            </div>
            <div>
              {lbl('Reason')}
              <select className={inp()} value={form.reason}
                onChange={(e) => set('reason', e.target.value as SalaryRevisionReason)}>
                {(Object.keys(SALARY_REVISION_REASON_LABELS) as SalaryRevisionReason[]).map((r) => (
                  <option key={r} value={r}>{SALARY_REVISION_REASON_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            {lbl('New Gross Salary (₹/month)', 'grossSalary', true)}
            <input className={inp('grossSalary')} type="number" min="0" value={form.grossSalary}
              onChange={(e) => set('grossSalary', e.target.value)} placeholder="e.g. 50000" />
            {incPct != null && (
              <p className="text-xs mt-1 font-semibold flex items-center gap-1"
                style={{ color: incPct >= 0 ? '#059669' : '#DC2626' }}>
                <ArrowUpRight size={11} />
                {incPct >= 0 ? `+${incPct}%` : `${incPct}%`} from {fmtINR(prevGross!)}
              </p>
            )}
          </div>

          {/* Optional breakdown */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Breakdown (optional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[['basicSalary', 'Basic'], ['hra', 'HRA'], ['otherAllowances', 'Other Allow.']] .map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
                  <input className="w-full text-sm px-3 py-2 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] bg-(--glass-panel-bg)"
                    type="number" min="0" value={(form as unknown as Record<string, string>)[k as string]}
                    onChange={(e) => setForm((p) => ({ ...p, [k as string]: e.target.value }))}
                    placeholder="₹" />
                </div>
              ))}
            </div>
          </div>

          <div>
            {lbl('Notes (optional)')}
            <textarea className={`${inp()} resize-none`} rows={2} value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Performance review ID, any context…" />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: '#0B1538' }}>
            {saving ? 'Saving…' : 'Record Revision'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

/** Thin access gate — see the note in HrLetterGeneratorPage (React #310). */
export function AdminSalaryHistoryPage() {
  const { profile } = useAuth();
  const isAdmin     = profile?.role === 'admin';
  const isHrManager = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrManager) return <Navigate to="/hrms/dashboard" replace />;
  return <AdminSalaryHistoryContent />;
}

function AdminSalaryHistoryContent() {
  const { user } = useAuth();

  const { records, loading } = useAllSalaryHistory();

  const [showAdd,       setShowAdd]       = useState(false);
  const [timelineEmp,   setTimelineEmp]   = useState<{ uid: string; displayName: string } | null>(null);
  const [empFilter,     setEmpFilter]     = useState('');
  const [search,        setSearch]        = useState('');
  const [employees,     setEmployees]     = useState<{ uid: string; displayName: string }[]>([]);

  const loadEmployees = async () => {
    if (employees.length) return;
    const snap = await getDocs(query(collection(db, 'users'), where('status', '==', 'active')));
    setEmployees(
      snap.docs
        .map((d) => ({ uid: d.id, displayName: (d.data().displayName as string) ?? d.id }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    );
  };

  // Map: employeeId → their most-recent gross salary (for increment % calc)
  const latestSalaryMap = useMemo(() => {
    const m = new Map<string, number>();
    // records are sorted desc by effectiveDate; first occurrence per employee = current
    records.forEach((r) => {
      if (!m.has(r.employeeId)) m.set(r.employeeId, r.grossSalary);
    });
    return m;
  }, [records]);

  const filtered = useMemo(() => records.filter((r) => {
    if (empFilter && r.employeeId !== empFilter) return false;
    if (search && !r.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [records, empFilter, search]);

  const handleSaveRevision = async (f: RevForm, prevGross: number | null, incPct: number | null) => {
    const emp = employees.find((e) => e.uid === f.employeeId);
    await recordSalaryRevision(
      {
        employeeId:   f.employeeId,
        employeeName: emp?.displayName ?? f.employeeId,
        effectiveDate: f.effectiveDate,
        grossSalary:  Number(f.grossSalary),
        basicSalary:  f.basicSalary  ? Number(f.basicSalary)  : null,
        hra:          f.hra          ? Number(f.hra)          : null,
        otherAllowances: f.otherAllowances ? Number(f.otherAllowances) : null,
        reason:       f.reason,
        incrementPercentage:       incPct,
        previousGrossSalary:       prevGross,
        relatedPerformanceReviewId: null,
        notes:        f.notes.trim() || null,
      },
      user!.uid,
    );
  };

  // CSV export
  const exportCSV = () => {
    const rows = [
      ['Employee', 'Effective Date', 'Gross (₹/mo)', 'Basic', 'HRA', 'Other Allow.', 'Reason', 'Increment %', 'Notes'],
      ...filtered.map((r) => [
        r.employeeName,
        r.effectiveDate,
        r.grossSalary,
        r.basicSalary ?? '',
        r.hra ?? '',
        r.otherAllowances ?? '',
        SALARY_REVISION_REASON_LABELS[r.reason],
        r.incrementPercentage != null ? `${r.incrementPercentage}%` : '',
        r.notes ?? '',
      ]),
    ];
    const csv  = rows.map((r) => r.map(String).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Salary_History_Finvastra_${format(new Date(), 'yyyy-MM')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Unique employees in records (for filter dropdown)
  const uniqueEmployees = useMemo(() => {
    const seen = new Map<string, string>();
    records.forEach((r) => seen.set(r.employeeId, r.employeeName));
    return Array.from(seen.entries())
      .map(([uid, displayName]) => ({ uid, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [records]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#0B1538' }}>
              <TrendingUp size={20} style={{ color: '#C9A961' }} />
            </span>
            Salary History
          </span>
        }
        subtitle="Track CTC revisions — joining, increments, promotions"
        pinKey="hrms.salary-history"
        actions={
          <div className="flex gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={14} />CSV
            </button>
            <button onClick={() => { loadEmployees(); setShowAdd(true); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white"
              style={{ backgroundColor: '#0B1538' }}>
              <Plus size={15} />Record Revision
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Records',    value: records.length,                                  color: 'var(--text-primary)' },
          { label: 'Employees Tracked',value: new Set(records.map((r) => r.employeeId)).size, color: '#0369A1' },
          { label: 'Avg Current Gross',
            value: uniqueEmployees.length
              ? fmtINR(Array.from(latestSalaryMap.values()).reduce((s, v) => s + v, 0) / latestSalaryMap.size)
              : '—',
            color: '#059669',
            noFormat: true,
          },
        ].map(({ label, value, color, noFormat }) => (
          <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className={`font-bold ${noFormat ? 'text-2xl' : 'text-3xl'}`} style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="text-xs px-3 py-1.5 border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
          value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
          <option value="">All employees</option>
          {uniqueEmployees.map((e) => <option key={e.uid} value={e.uid}>{e.displayName}</option>)}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="pl-8 pr-3 py-1.5 text-xs border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
            placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <TrendingUp size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No salary records yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Record the joining CTC for each employee, then log increments as they happen.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)" style={{ backgroundColor: '#F8F9FC' }}>
                {['Employee', 'Effective Date', 'Gross / Month', 'Increment', 'Reason', 'Notes', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--shell-border)">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-(--glass-panel-bg) transition-colors">
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.employeeName}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {format(new Date(r.effectiveDate), 'd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {fmtINR(r.grossSalary)}
                    {r.basicSalary != null && (
                      <p className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
                        Basic {fmtINR(r.basicSalary)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.incrementPercentage != null ? (
                      <span className="flex items-center gap-0.5 font-bold"
                        style={{ color: r.incrementPercentage >= 0 ? '#059669' : '#DC2626' }}>
                        <ArrowUpRight size={11} />{r.incrementPercentage >= 0 ? '+' : ''}{r.incrementPercentage}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3"><ReasonPill reason={r.reason} /></td>
                  <td className="px-4 py-3 text-xs max-w-[180px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="line-clamp-2">{r.notes ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        loadEmployees();
                        setTimelineEmp({ uid: r.employeeId, displayName: r.employeeName });
                      }}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                      Timeline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddRevisionModal
          employees={employees}
          previousSalaries={latestSalaryMap}
          onClose={() => setShowAdd(false)}
          onSave={handleSaveRevision}
        />
      )}

      {timelineEmp && (
        <EmployeeTimeline
          employeeId={timelineEmp.uid}
          employeeName={timelineEmp.displayName}
          onClose={() => setTimelineEmp(null)}
        />
      )}
    </div>
  );
}
