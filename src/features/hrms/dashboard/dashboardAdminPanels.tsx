/**
 * Admin/HR-only dashboard panels and their reads: pending-approval counts,
 * headcount by department, the employee's own pending requests, and the
 * HR pending-actions panel.
 * 
 * Extracted verbatim from HrmsDashboardPage.tsx (2026-07-23).
 */
import { getDocs } from 'firebase/firestore';
import { ChevronRight, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

// ─── Pending HR action counts (admin/manager only) ───────────────────────────
// Three real-time subscriptions: claims, IT declarations, leave encashment.
// Leave count comes from the already-loaded usePendingApprovals() in the page.

export function usePendingHrCounts(enabled: boolean) {
  const [counts, setCounts] = useState({ claims: 0, itDecl: 0, encashment: 0 });

  useEffect(() => {
    if (!enabled) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(db, 'claims'), where('status', '==', 'pending')),
      (snap) => setCounts((c) => ({ ...c, claims: snap.size })),
      () => {},
    ));
    unsubs.push(onSnapshot(
      query(collection(db, 'it_declarations'), where('status', '==', 'submitted')),
      (snap) => setCounts((c) => ({ ...c, itDecl: snap.size })),
      () => {},
    ));
    unsubs.push(onSnapshot(
      query(collection(db, 'leave_encashment_requests'), where('status', '==', 'pending')),
      (snap) => setCounts((c) => ({ ...c, encashment: snap.size })),
      () => {},
    ));

    return () => unsubs.forEach((u) => u());
  }, [enabled]);

  return counts;
}

// ─── Headcount hook (admin only) ─────────────────────────────────────────────

export function useHeadcount(enabled: boolean) {
  const [data, setData] = useState<{ total: number; byDept: [string, number][] }>({ total: 0, byDept: [] });

  useEffect(() => {
    if (!enabled) return;
    getDocs(query(collection(db, 'users'), where('status', '==', 'active')))
      .then((snap) => {
        const deptMap = new Map<string, number>();
        snap.forEach((d) => {
          const dept = (d.data() as { department?: string }).department ?? 'Other';
          deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
        });
        setData({
          total:  snap.size,
          byDept: [...deptMap.entries()].sort((a, b) => b[1] - a[1]),
        });
      })
      .catch(() => {});
  }, [enabled]);

  return data;
}

export function fmtClock(iso: unknown): string {
  const d = typeof iso === 'string' ? new Date(iso) : (iso as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}


// ─── MyRequestsCard ───────────────────────────────────────────────────────────
// One glance at everything the EMPLOYEE has asked for that's still pending —
// leave, claims, attendance corrections, encashment. Before this, each status
// lived on its own page. Hidden entirely when nothing is pending.

export function useMyPendingRequests(uid: string) {
  const [items, setItems] = useState<Array<{ key: string; label: string; detail: string; link: string }>>([]);
  useEffect(() => {
    if (!uid) return;
    const unsubs: Array<() => void> = [];
    const parts: Record<string, Array<{ key: string; label: string; detail: string; link: string }>> = {};
    const emit = () => setItems(Object.values(parts).flat());
    const sub = (col: string, field: string, label: string, link: string, detail: (d: Record<string, unknown>) => string) => {
      unsubs.push(onSnapshot(
        query(collection(db, col), where(field, '==', uid), where('status', '==', 'pending')),
        (snap) => { parts[col] = snap.docs.map((doc) => ({ key: `${col}_${doc.id}`, label, detail: detail(doc.data()), link })); emit(); },
        () => { parts[col] = []; emit(); },
      ));
    };
    sub('leave_applications', 'employeeId', 'Leave', '/hrms/leave',
      (d) => `${String(d.type ?? '')} · ${String(d.fromDate ?? '')} → ${String(d.toDate ?? '')}`);
    sub('claims', 'employeeId', 'Claim', '/hrms/claims',
      (d) => `${String(d.claimType ?? '')} · ₹${Number(d.amount ?? 0).toLocaleString('en-IN')}`);
    sub('attendance_regularizations', 'employeeId', 'Attendance correction', '/hrms/attendance',
      (d) => String(d.date ?? ''));
    sub('leave_encashment_requests', 'employeeId', 'Encashment', '/hrms/leave',
      (d) => `${Number(d.leaveDays ?? 0)} day(s) · ₹${Number(d.totalAmount ?? 0).toLocaleString('en-IN')}`);
    return () => unsubs.forEach((u) => u());
  }, [uid]);
  return items;
}

export function MyRequestsCard({ uid }: { uid: string }) {
  const navigate = useNavigate();
  const items = useMyPendingRequests(uid);
  if (items.length === 0) return null;
  return (
    <div className="glass-panel p-4 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
        My pending requests
      </p>
      <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
        {items.map((it) => (
          <button key={it.key} onClick={() => navigate(it.link)}
            className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-(--shell-hover-soft) rounded px-2 -mx-2 transition-colors">
            <p className="text-sm min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
              <span className="font-medium">{it.label}</span>
              <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{it.detail}</span>
            </p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ color: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.12)' }}>
              Waiting for approval
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── HrPendingActionsPanel ────────────────────────────────────────────────────
// Consolidated panel showing every pending HR action type in one place.

export function HrPendingActionsPanel({
  leaveCount, claimsCount, itDeclCount, encashmentCount,
}: {
  leaveCount:     number;
  claimsCount:    number;
  itDeclCount:    number;
  encashmentCount: number;
}) {
  const navigate = useNavigate();

  const actions = [
    { count: leaveCount,      label: 'leave application',    labelPlural: 'leave applications',    path: '/hrms/leave/admin',              color: '#1D4ED8' },
    { count: claimsCount,     label: 'expense claim',        labelPlural: 'expense claims',         path: '/hrms/admin/claims',             color: '#7C3AED' },
    { count: itDeclCount,     label: 'IT declaration',       labelPlural: 'IT declarations',        path: '/hrms/admin/it-declarations',    color: '#0891B2' },
    { count: encashmentCount, label: 'encashment request',   labelPlural: 'encashment requests',    path: '/hrms/leave/admin',              color: '#D97706' },
  ].filter((a) => a.count > 0);

  const total = actions.reduce((s, a) => s + a.count, 0);
  if (total === 0) return null;

  return (
    <div className="glass-panel p-5 mb-6 relative" style={{ borderColor: 'rgba(201,169,97,0.20)' }}>
      <button onClick={() => navigate('/hrms/admin/approvals')}
        className="absolute top-4 right-5 text-xs font-semibold hover:opacity-80"
        style={{ color: '#C9A961' }}>
        Open Approvals inbox →
      </button>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#C9A961' }}>
        {total} pending action{total !== 1 ? 's' : ''} need your review
      </p>
      <div className="space-y-1.5">
        {actions.map(({ count, label, labelPlural, path, color }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className="group w-full flex items-center justify-between glass-panel px-4 py-2.5 transition-all">
            <div className="flex items-center gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ backgroundColor: color + '30', color }}>
                {count}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {count > 1 ? `${count} ${labelPlural}` : `${count} ${label}`} pending
              </span>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── HeadcountCard ────────────────────────────────────────────────────────────

export function HeadcountCard({ total, byDept }: { total: number; byDept: [string, number][] }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/hrms/employees')}
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
            <Users size={18} />
          </div>
          <div className="text-left">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Headcount</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{total} active</p>
          </div>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      {byDept.length > 0 && (
        <div className="space-y-2">
          {byDept.slice(0, 5).map(([dept, count]) => (
            <div key={dept} className="flex items-center gap-2">
              <span className="text-xs w-44 truncate shrink-0 text-left" style={{ color: 'var(--text-muted)' }}>{dept}</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${(count / (total || 1)) * 100}%`, backgroundColor: 'rgba(201,169,97,0.50)' }} />
              </div>
              <span className="text-xs font-semibold w-4 text-right tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
