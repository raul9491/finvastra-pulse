/**
 * ApprovalsPage — /hrms/admin/approvals — ONE inbox for everything waiting on
 * HR (2026-07-03 HRMS simplification). Before this, approvals lived in NINE
 * different admin pages; HR had to hop between them to find what's pending.
 *
 * Each section shows the live pending count + the oldest few items + a
 * "Review →" link into the existing page where the actual approve/reject
 * happens (those pages keep their context — balances, bills, tabs). This page
 * never mutates anything itself; it's the radar, not the cockpit.
 *
 * Admin-only page (hrmsAdmin nav access) → the ~9 live listeners are fine.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarOff, Banknote, Receipt, Clock3, FileSearch2, UserPlus,
  LifeBuoy, Hourglass, Award, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { collection, query, where, onSnapshot, type QueryConstraint } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { PageHeader, Card } from '../../../components/ui/primitives';
import { currentReviewYear } from '../hooks/usePerformance';

interface FeedItem { id: string; name: string; detail: string; atMs: number }
interface SectionDef {
  key: string;
  title: string;
  Icon: typeof CalendarOff;
  color: string;
  route: string;
  col: string;
  wheres: QueryConstraint[];
  map: (id: string, d: Record<string, unknown>, nameOf: (uid: string) => string) => FeedItem;
}

const tsMs = (v: unknown): number => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t?.toMillis ? t.toMillis() : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const SECTIONS: SectionDef[] = [
  {
    key: 'leave', title: 'Leave applications', Icon: CalendarOff, color: '#C9A961',
    route: '/hrms/leave/admin', col: 'leave_applications',
    wheres: [where('status', '==', 'pending')],
    map: (id, d, nameOf) => ({
      id, name: nameOf(str(d.employeeId)),
      detail: `${str(d.type)} · ${str(d.fromDate)} → ${str(d.toDate)} (${num(d.days)}d)`,
      atMs: tsMs(d.appliedAt),
    }),
  },
  {
    key: 'encashment', title: 'Leave encashment', Icon: Banknote, color: '#34A853',
    route: '/hrms/leave/admin', col: 'leave_encashment_requests',
    wheres: [where('status', '==', 'pending')],
    map: (id, d) => ({
      id, name: str(d.employeeName),
      detail: `${num(d.leaveDays)} day(s) · ₹${num(d.totalAmount).toLocaleString('en-IN')}`,
      atMs: tsMs(d.submittedAt) || tsMs(d.createdAt),
    }),
  },
  {
    key: 'claims', title: 'Claims', Icon: Receipt, color: '#5B9BD5',
    route: '/hrms/admin/claims', col: 'claims',
    wheres: [where('status', '==', 'pending')],
    map: (id, d) => ({
      id, name: str(d.employeeName),
      detail: `${str(d.claimType)} · ₹${num(d.amount).toLocaleString('en-IN')}`,
      atMs: tsMs(d.submittedAt),
    }),
  },
  {
    key: 'corrections', title: 'Attendance corrections', Icon: Clock3, color: '#F59E0B',
    route: '/hrms/admin/attendance?tab=corrections', col: 'attendance_regularizations',
    wheres: [where('status', '==', 'pending')],
    map: (id, d) => ({
      id, name: str(d.employeeName),
      detail: `${str(d.date)} · ${str(d.requestedCheckIn) || '—'}–${str(d.requestedCheckOut) || '—'}`,
      atMs: tsMs(d.submittedAt) || tsMs(d.createdAt),
    }),
  },
  {
    key: 'itdecl', title: 'IT declarations', Icon: FileSearch2, color: '#8B5CF6',
    route: '/hrms/admin/it-declarations', col: 'it_declarations',
    wheres: [where('status', '==', 'submitted')],
    map: (id, d, nameOf) => ({
      id, name: nameOf(str(d.employeeId)),
      detail: `FY ${num(d.year)}-${(num(d.year) + 1) % 100} · ₹${num(d.totalDeductions).toLocaleString('en-IN')} declared`,
      atMs: tsMs(d.submittedAt),
    }),
  },
  {
    key: 'access', title: 'Access requests', Icon: UserPlus, color: '#EC4899',
    route: '/hrms/admin/access-requests', col: 'access_requests',
    wheres: [where('status', '==', 'pending')],
    map: (id, d) => ({
      id, name: str(d.fullName),
      detail: `${str(d.designation)} · ${str(d.department)}`,
      atMs: tsMs(d.submittedAt),
    }),
  },
  {
    key: 'helpdesk', title: 'Helpdesk tickets', Icon: LifeBuoy, color: '#06B6D4',
    route: '/hrms/admin/hr-helpdesk', col: 'hr_tickets',
    wheres: [where('status', 'in', ['open', 'in_review'])],
    map: (id, d) => ({
      id, name: (d.isAnonymous ? 'Anonymous' : str(d.employeeName)) || 'Employee',
      detail: `${str(d.category)} · ${str(d.subject) || str(d.title)}`,
      atMs: tsMs(d.createdAt) || tsMs(d.raisedAt),
    }),
  },
  {
    key: 'probation', title: 'Probation decisions', Icon: Hourglass, color: '#F97316',
    route: '/hrms/admin/probation', col: 'probation_records',
    wheres: [where('status', 'in', ['on_probation', 'extended'])],
    map: (id, d) => ({
      id, name: str(d.employeeName),
      detail: `${str(d.status) === 'extended' ? 'Extended' : 'On probation'} · ends ${str(d.probationEndDate) || '—'}`,
      atMs: 0,
    }),
  },
  {
    key: 'reviews', title: 'Performance reviews', Icon: Award, color: '#10B981',
    route: '/hrms/admin/performance', col: 'performance_reviews',
    wheres: [where('year', '==', currentReviewYear()), where('status', 'in', ['self_review', 'manager_review'])],
    map: (id, d) => ({
      id, name: str(d.employeeName),
      detail: str(d.status) === 'self_review' ? 'Self-review in progress' : 'Awaiting manager review',
      atMs: tsMs(d.updatedAt),
    }),
  },
];

function useSectionFeed(def: SectionDef, nameOf: (uid: string) => string) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, def.col), ...def.wheres),
      (snap) => {
        setCount(snap.size);
        const rows = snap.docs.map((d) => def.map(d.id, d.data(), nameOf));
        rows.sort((a, b) => a.atMs - b.atMs); // oldest first — longest-waiting on top
        setItems(rows.slice(0, 5));
      },
      () => { setCount(0); setItems([]); },
    );
    // def is a stable module constant; nameOf changes as employees load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, nameOf]);
  return { items, count };
}

function SectionCard({ def, nameOf }: { def: SectionDef; nameOf: (uid: string) => string }) {
  const navigate = useNavigate();
  const { items, count } = useSectionFeed(def, nameOf);
  if (count === 0) return null; // NOTHING LOCKED / nothing empty — clear inbox shows only what's waiting
  return (
    <Card>
      <button onClick={() => navigate(def.route)} className="w-full flex items-center justify-between gap-3 mb-3 text-left group">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${def.color}22`, color: def.color }}>
            <def.Icon size={15} />
          </div>
          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{def.title}</p>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ color: def.color, backgroundColor: `${def.color}1f` }}>{count}</span>
        </div>
        <span className="text-xs font-semibold shrink-0 inline-flex items-center gap-0.5 group-hover:opacity-80" style={{ color: '#C9A961' }}>
          Review <ChevronRight size={13} />
        </span>
      </button>
      <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
        {items.map((it) => (
          <div key={it.id} className="py-2 flex items-baseline justify-between gap-3">
            <p className="text-sm min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
              <span className="font-medium">{it.name || 'Employee'}</span>
              <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{it.detail}</span>
            </p>
            {it.atMs > 0 && (
              <span className="text-[11px] shrink-0" style={{ color: 'var(--text-dim)' }}>
                {new Date(it.atMs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
        ))}
        {count > items.length && (
          <p className="pt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>+ {count - items.length} more — open Review for the full list.</p>
        )}
      </div>
    </Card>
  );
}

export function ApprovalsPage() {
  const { employees } = useAllEmployees();
  const nameOf = useMemo(() => {
    const m = new Map(employees.map((e) => [e.userId, e.displayName]));
    return (uid: string) => m.get(uid) ?? 'Employee';
  }, [employees]);

  // Total pending across sections — tracked by each SectionCard rendering or
  // not; we compute an independent lightweight total for the empty state.
  const [totals, setTotals] = useState<Record<string, number>>({});
  useEffect(() => {
    const unsubs = SECTIONS.map((def) =>
      onSnapshot(query(collection(db, def.col), ...def.wheres),
        (snap) => setTotals((t) => ({ ...t, [def.key]: snap.size })),
        () => setTotals((t) => ({ ...t, [def.key]: 0 }))),
    );
    return () => unsubs.forEach((u) => u());
  }, []);
  const grandTotal = Object.values(totals).reduce((s, n) => s + n, 0);
  const loadedAll = Object.keys(totals).length === SECTIONS.length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Approvals"
        subtitle="Everything waiting on HR, in one inbox — oldest first. Review opens the full page for each type."
        pinKey="hrms.approvals"
      />

      {loadedAll && grandTotal === 0 && (
        <Card>
          <p className="text-sm flex items-center gap-2 py-4 justify-center" style={{ color: '#34d399' }}>
            <CheckCircle2 size={16} /> All clear — nothing is waiting for approval right now.
          </p>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {SECTIONS.map((def) => <SectionCard key={def.key} def={def} nameOf={nameOf} />)}
      </div>
    </div>
  );
}
