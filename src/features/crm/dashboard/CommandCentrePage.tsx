import { useEffect, useRef, useState } from 'react';
import { inrRound as fmtINR } from '../../../lib/money';
import { useNavigate } from 'react-router-dom';
import {
  collection, collectionGroup, getDocs, query, where, orderBy, limit,
} from 'firebase/firestore';
import {
  Command, Users2, CalendarCheck, AlertTriangle, ShieldAlert, FileCheck, Receipt,
  FileText, ClockAlert, TrendingUp, CheckCircle2, ArrowRight, Loader2,
} from 'lucide-react';
import { db } from '../../../lib/firebase';
import { PageHeader } from '../../../components/ui/primitives';
import { useAuth } from '../../auth/AuthContext';
import { useTeamTargets, achievementPct } from '../hooks/useRmTargets';
import { DataView } from '../../../components/ui/DataView';
import { RePie } from '../../../components/ui/charts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtCompact = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return fmtINR(v);
};
const tsMs = (v: any): number => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const periodStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dayStartMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function timeAgo(ms: number): string {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Emp { uid: string; name: string; photoURL?: string }
interface ComplianceItem { id: string; label: string; days: number; status: 'overdue' | 'due_soon' }
interface FeedItem { icon: string; text: string; ms: number }

interface DashData {
  present: Emp[]; onLeave: Emp[]; notCheckedIn: Emp[];
  pending: { leave: number; claims: number; it: number; corrections: number; encashment: number };
  openPipeline: number;
  byLine: Record<'loan' | 'wealth' | 'insurance', { value: number; count: number }>;
  wonThisMonth: number;
  overdueSla: number;
  compliance: ComplianceItem[];
  feed: FeedItem[];
}

const avatar = (e: Emp) => (e.name?.[0] ?? '?').toUpperCase();

// ─── Page ─────────────────────────────────────────────────────────────────────
export function CommandCentrePage() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const canAccess = profile?.role === 'admin' || profile?.commandCentreAccess === true;

  const period = periodStr();
  const { rows: teamRows, loading: teamLoading } = useTeamTargets(period, canAccess);

  const [data, setData] = useState<DashData | null>(null);

  const attendanceRef = useRef<HTMLDivElement>(null);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);
  const complianceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canAccess) return;
    let alive = true;
    (async () => {
      const today = todayStr();
      const now = Date.now();
      const afterTen = new Date().getHours() >= 10;

      // Fail-safe per query — one denied/missing-index collection must not blank the whole
      // dashboard. A rejected query degrades that section to empty instead of killing the page.
      const EMPTY: any = { forEach: () => {}, size: 0, docs: [] as any[] };
      const safe = (p: Promise<any>): Promise<any> => p.catch(() => EMPTY);

      const [
        usersSnap, attSnap, leaveP, claimsP, itP, corrP, encP,
        openOpps, wonOpps, leadsSnap, compSnap, auditSnap, leaveRecent, paidComm,
      ] = await Promise.all([
        safe(getDocs(collection(db, 'users'))),
        safe(getDocs(query(collection(db, 'attendance'), where('date', '==', today)))),
        safe(getDocs(query(collection(db, 'leave_applications'), where('status', '==', 'pending')))),
        safe(getDocs(query(collection(db, 'claims'), where('status', '==', 'pending')))),
        safe(getDocs(query(collection(db, 'it_declarations'), where('status', '==', 'submitted')))),
        safe(getDocs(query(collection(db, 'attendance_regularizations'), where('status', '==', 'pending')))),
        safe(getDocs(query(collection(db, 'leave_encashment_requests'), where('status', '==', 'pending')))),
        safe(getDocs(query(collectionGroup(db, 'opportunities'), where('status', '==', 'open')))),
        safe(getDocs(query(collectionGroup(db, 'opportunities'), where('status', '==', 'won')))),
        safe(getDocs(query(collection(db, 'leads'), where('deleted', '==', false)))),
        safe(getDocs(collection(db, 'compliance_records'))),
        safe(getDocs(query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(5)))),
        safe(getDocs(query(collection(db, 'leave_applications'), orderBy('appliedAt', 'desc'), limit(12)))),
        safe(getDocs(query(collection(db, 'commission_records'), where('status', '==', 'paid')))),
      ]);

      // Users map (active only)
      const nameByUid = new Map<string, Emp>();
      const activeEmps: Emp[] = [];
      usersSnap.forEach((d) => {
        const u: any = d.data();
        const emp: Emp = { uid: d.id, name: u.displayName ?? u.email ?? d.id, photoURL: u.photoURL };
        nameByUid.set(d.id, emp);
        if (u.employeeStatus !== 'inactive') activeEmps.push(emp);
      });

      // Attendance classification
      const attByUid = new Map<string, any>();
      attSnap.forEach((d) => attByUid.set((d.data() as any).userId, d.data()));
      const present: Emp[] = [], onLeave: Emp[] = [], notCheckedIn: Emp[] = [];
      for (const emp of activeEmps) {
        const a = attByUid.get(emp.uid);
        if (a?.status === 'leave') onLeave.push(emp);
        else if (a && (a.checkIn || a.status === 'present' || a.status === 'half_day')) present.push(emp);
        else if (afterTen) notCheckedIn.push(emp);
      }

      // Pipeline
      const byLine: DashData['byLine'] = { loan: { value: 0, count: 0 }, wealth: { value: 0, count: 0 }, insurance: { value: 0, count: 0 } };
      let openPipeline = 0;
      openOpps.forEach((d) => {
        const o: any = d.data(); const v = Number(o.dealSize ?? 0);
        openPipeline += v;
        const line = (o.opportunityType ?? 'loan') as keyof DashData['byLine'];
        if (byLine[line]) { byLine[line].value += v; byLine[line].count++; }
      });
      let wonThisMonth = 0;
      wonOpps.forEach((d) => { const o: any = d.data(); if (typeof o.actualCloseDate === 'string' && o.actualCloseDate.startsWith(period)) wonThisMonth += Number(o.dealSize ?? 0); });

      // Overdue SLA
      let overdueSla = 0;
      leadsSnap.forEach((d) => { const l: any = d.data(); const dl = tsMs(l.slaDeadline); if (dl && dl < now) overdueSla++; });

      // Compliance
      const compliance: ComplianceItem[] = [];
      compSnap.forEach((d) => {
        const r: any = d.data();
        if (r.filedAt) return;
        const due = r.dueDate ? new Date(r.dueDate).getTime() : 0;
        if (!due) return;
        const days = Math.round((due - dayStartMs()) / 86400000);
        const label = r.title ?? r.type ?? 'Compliance item';
        if (days < 0) compliance.push({ id: d.id, label, days: -days, status: 'overdue' });
        else if (days <= 7) compliance.push({ id: d.id, label, days, status: 'due_soon' });
      });
      compliance.sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1));

      // Activity feed
      const feed: FeedItem[] = [];
      auditSnap.forEach((d) => {
        const a: any = d.data();
        const actor = nameByUid.get(a.actor)?.name ?? a.actorName ?? a.actor ?? 'Admin';
        feed.push({ icon: '👤', text: `${actor} — ${a.action ?? 'action'}`, ms: tsMs(a.at) });
      });
      let lc = 0;
      leaveRecent.forEach((d) => {
        const l: any = d.data();
        if (lc >= 3) return;
        if (l.status === 'approved' || l.status === 'rejected') {
          const who = nameByUid.get(l.employeeId)?.name ?? 'Employee';
          feed.push({ icon: l.status === 'approved' ? '✅' : '🚫', text: `${who}'s leave ${l.status}`, ms: tsMs(l.approvedAt) || tsMs(l.appliedAt) });
          lc++;
        }
      });
      const paid = paidComm.docs.map((d) => d.data() as any)
        .sort((a, b) => (b.actualPayoutDate ?? '').localeCompare(a.actualPayoutDate ?? '')).slice(0, 3);
      paid.forEach((r) => {
        const ms = r.actualPayoutDate ? new Date(r.actualPayoutDate).getTime() : tsMs(r.updatedAt);
        feed.push({ icon: '💰', text: `${r.product ?? 'Deal'} paid ${fmtCompact(Number(r.actualAmount ?? r.calculatedCommission ?? 0))}`, ms });
      });
      feed.sort((a, b) => b.ms - a.ms);

      if (alive) setData({
        present, onLeave, notCheckedIn,
        pending: { leave: leaveP.size, claims: claimsP.size, it: itP.size, corrections: corrP.size, encashment: encP.size },
        openPipeline, byLine, wonThisMonth, overdueSla,
        compliance, feed: feed.slice(0, 10),
      });
    })().catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [canAccess, period]);

  if (!canAccess) return <div className="glass-panel p-6 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>Admin / manager access only.</div>;

  const pendingTotal = data ? data.pending.leave + data.pending.claims + data.pending.it + data.pending.corrections + data.pending.encashment : 0;
  const overdueCompliance = data?.compliance.filter((c) => c.status === 'overdue').length ?? 0;
  const firstName = profile?.displayName?.split(' ')[0] ?? 'there';
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  // Team targets totals (for pipeline target + achievement)
  const targetTotal = teamRows.reduce((s, r) => s + (r.target?.targets.disbursalAmount ?? 0), 0);
  const disbursalActualTotal = teamRows.reduce((s, r) => s + r.actuals.disbursalAmount, 0);
  const teamAchievement = achievementPct(disbursalActualTotal, targetTotal);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const Chip = ({ icon: Icon, label, count, onClick }: { icon: any; label: string; count: number; onClick: () => void }) => {
    const danger = count > 0;
    return (
      <button onClick={onClick} className="glass-panel p-3 flex items-center gap-3 text-left transition-all hover:-translate-y-0.5"
        style={{ border: `1px solid ${danger ? 'rgba(248,113,113,0.4)' : 'var(--shell-border)'}` }}>
        <Icon size={18} style={{ color: danger ? '#f87171' : 'var(--shell-text-dim)' }} />
        <div>
          <p className="text-xl font-bold leading-none" style={{ color: danger ? '#f87171' : 'var(--text-primary)' }}>{count}</p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
        </div>
      </button>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ── PART 1 — Header ── */}
      <PageHeader
        title={<span className="flex items-center gap-2"><Command size={22} style={{ color: '#C9A961' }} /> {greeting}, {firstName}</span>}
        subtitle={`${dateLabel} — one screen across HR, CRM and payouts.`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Chip icon={Users2}       label="checked in today"   count={data?.present.length ?? 0} onClick={() => scrollTo(attendanceRef)} />
        <Chip icon={CalendarCheck} label="pending approvals"   count={pendingTotal}              onClick={() => scrollTo(approvalsRef)} />
        <Chip icon={ClockAlert}   label="leads overdue SLA"    count={data?.overdueSla ?? 0}     onClick={() => scrollTo(pipelineRef)} />
        <Chip icon={ShieldAlert}  label="compliance overdue"   count={overdueCompliance}         onClick={() => scrollTo(complianceRef)} />
      </div>

      {!data || teamLoading ? (
        <div className="glass-panel p-10 flex justify-center"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--shell-text-dim)' }} /></div>
      ) : (
        <>
          {/* ── PART 2 — Attendance ── */}
          <section ref={attendanceRef} className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><Users2 size={16} style={{ color: '#C9A961' }} /> Team attendance today</h3>
            <div className="flex gap-4 text-xs mb-4" style={{ color: 'var(--shell-text-dim)' }}>
              <span><b style={{ color: '#34d399' }}>{data.present.length}</b> Present</span>
              <span><b style={{ color: '#C9A961' }}>{data.onLeave.length}</b> On Leave</span>
              <span><b style={{ color: '#f87171' }}>{data.notCheckedIn.length}</b> Not checked in</span>
            </div>
            <DataView headless
              graph={<RePie height={220} colors={['#34A853', '#C9A961', '#EF4444']} data={[
                { name: 'Present', value: data.present.length },
                { name: 'On Leave', value: data.onLeave.length },
                { name: 'Not checked in', value: data.notCheckedIn.length },
              ]} />}
              table={
                <>
                  {([
                    ['Present', data.present, '#34d399'],
                    ['On Leave', data.onLeave, '#C9A961'],
                    ['Not checked in', data.notCheckedIn, '#f87171'],
                  ] as const).filter(([, list]) => list.length > 0).map(([label, list, color]) => (
                    <div key={label} className="mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {list.map((e) => (
                          <button key={e.uid} onClick={() => navigate(`/hrms/employees/${e.uid}`)} title={e.name}
                            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{ border: `2px solid ${color}`, color: 'var(--text-primary)', backgroundColor: 'var(--shell-hover-soft)' }}>
                            {e.photoURL ? <img src={e.photoURL} alt={e.name} className="w-full h-full rounded-full object-cover" /> : avatar(e)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              }
            />
          </section>

          {/* ── PART 3 — Pending approvals ── */}
          <section ref={approvalsRef} className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><CalendarCheck size={16} style={{ color: '#C9A961' }} /> Pending approvals</h3>
            {pendingTotal === 0 ? (
              <p className="text-sm flex items-center gap-2" style={{ color: '#34d399' }}><CheckCircle2 size={16} /> All caught up</p>
            ) : (
              <div className="space-y-2">
                {([
                  [FileCheck, 'Leave Requests', data.pending.leave, '/hrms/leave/admin'],
                  [Receipt, 'Claims', data.pending.claims, '/hrms/admin/claims'],
                  [FileText, 'IT Declarations', data.pending.it, '/hrms/admin/it-declarations'],
                  [CalendarCheck, 'Attendance corrections', data.pending.corrections, '/hrms/admin/attendance'],
                  [Receipt, 'Leave encashment', data.pending.encashment, '/hrms/leave/admin'],
                ] as const).filter(([, , n]) => n > 0).map(([Icon, label, n, link]) => (
                  <button key={label} onClick={() => navigate(link)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-(--shell-hover-soft)" style={{ border: '1px solid var(--shell-border)' }}>
                    <Icon size={16} style={{ color: '#C9A961' }} />
                    <span className="text-sm flex-1 text-left" style={{ color: 'var(--text-primary)' }}>{label}</span>
                    <span className="text-sm font-bold" style={{ color: '#f87171' }}>{n}</span>
                    <span className="text-xs font-semibold flex items-center gap-1" style={{ color: '#C9A961' }}>Review <ArrowRight size={12} /></span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── PART 4 — Pipeline health ── */}
          <section ref={pipelineRef} className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><TrendingUp size={16} style={{ color: '#C9A961' }} /> Pipeline health</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                ['Open pipeline', fmtCompact(data.openPipeline), 'var(--text-primary)'],
                ['Won this month', fmtCompact(data.wonThisMonth), '#34d399'],
                ['Target', fmtCompact(targetTotal), '#C9A961'],
                ['Achievement', `${teamAchievement}%`, teamAchievement >= 75 ? '#34d399' : '#C9A961'],
              ].map(([label, val, color]) => (
                <div key={label} className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                  <p className="text-lg font-bold" style={{ color: color as string }}>{val}</p>
                  <p className="text-[10px]" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
                </div>
              ))}
            </div>
            <DataView headless className="mb-3"
              table={
                <div className="space-y-1.5">
                  {(['loan', 'wealth', 'insurance'] as const).map((line) => {
                    const max = Math.max(data.byLine.loan.value, data.byLine.wealth.value, data.byLine.insurance.value, 1);
                    const w = Math.round((data.byLine[line].value / max) * 100);
                    return (
                      <div key={line} className="flex items-center gap-3">
                        <span className="text-xs capitalize w-16" style={{ color: 'var(--shell-text-secondary)' }}>{line}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
                          <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: '#C9A961' }} />
                        </div>
                        <span className="text-xs w-28 text-right" style={{ color: 'var(--text-primary)' }}>{fmtCompact(data.byLine[line].value)} <span style={{ color: 'var(--shell-text-dim)' }}>({data.byLine[line].count})</span></span>
                      </div>
                    );
                  })}
                </div>
              }
              graph={<RePie money height={240} data={[
                { name: 'Loan', value: data.byLine.loan.value },
                { name: 'Wealth', value: data.byLine.wealth.value },
                { name: 'Insurance', value: data.byLine.insurance.value },
              ]} />}
            />
            <button onClick={() => navigate('/crm/leads?filter=overdue')} className="text-sm font-semibold flex items-center gap-1.5" style={{ color: data.overdueSla > 0 ? '#f87171' : 'var(--shell-text-dim)' }}>
              <AlertTriangle size={14} /> {data.overdueSla} leads overdue SLA →
            </button>
          </section>

          {/* ── PART 5 — RM targets snapshot ── */}
          <section className="glass-panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><TrendingUp size={16} style={{ color: '#C9A961' }} /> RM targets ({period})</h3>
              <button onClick={() => navigate('/crm/targets')} className="text-xs font-semibold hover:underline" style={{ color: '#C9A961' }}>View full targets →</button>
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                  {['RM', 'Disbursals', 'Conversions', 'Status'].map((h) => <th key={h} className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {teamRows.filter((r) => r.target).map((r) => <RmRow key={r.rmId} row={r} period={period} />)}
                  {teamRows.filter((r) => r.target).length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-sm" style={{ color: 'var(--shell-text-dim)' }}>No targets set this month.</td></tr>}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {teamRows.filter((r) => r.target).map((r) => <RmCard key={r.rmId} row={r} period={period} />)}
            </div>
          </section>

          {/* ── PART 6 — Compliance ── */}
          <section ref={complianceRef} className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><ShieldAlert size={16} style={{ color: '#C9A961' }} /> Compliance alerts</h3>
            {data.compliance.length === 0 ? (
              <p className="text-sm flex items-center gap-2" style={{ color: '#34d399' }}><CheckCircle2 size={16} /> All compliance on track</p>
            ) : (
              <DataView headless
                graph={<RePie height={220} colors={['#EF4444', '#F59E0B']} data={[
                  { name: 'Overdue', value: data.compliance.filter((c) => c.status === 'overdue').length },
                  { name: 'Due soon', value: data.compliance.filter((c) => c.status !== 'overdue').length },
                ]} />}
                table={
                  <div className="space-y-2">
                    {data.compliance.map((c) => {
                      const red = c.status === 'overdue';
                      return (
                        <button key={c.id} onClick={() => navigate('/hrms/admin/compliance')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-(--shell-hover-soft)"
                          style={{ border: `1px solid ${red ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)'}` }}>
                          <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{c.label} — <span style={{ color: red ? '#f87171' : '#fbbf24' }}>{red ? `overdue by ${c.days}d` : `due in ${c.days}d`}</span></span>
                          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: '#C9A961' }}>Mark as Filed <ArrowRight size={12} /></span>
                        </button>
                      );
                    })}
                  </div>
                }
              />
            )}
          </section>

          {/* ── PART 7 — Activity feed ── */}
          <section className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Recent activity</h3>
            {data.feed.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>No recent activity.</p>
            ) : (
              <div className="space-y-2">
                {data.feed.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="text-base">{f.icon}</span>
                    <span className="flex-1" style={{ color: 'var(--text-primary)' }}>{f.text}</span>
                    <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>{timeAgo(f.ms)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── RM status helpers ────────────────────────────────────────────────────────
function rmStatus(row: { target: any; actuals: any }, period: string): { dot: string; label: string } {
  if (!row.target) return { dot: '⚪', label: 'No target' };
  const t = row.target.targets;
  const pcts = [
    achievementPct(row.actuals.newLeads, t.newLeads),
    achievementPct(row.actuals.leadsConverted, t.leadsConverted),
    achievementPct(row.actuals.disbursalAmount, t.disbursalAmount),
    achievementPct(row.actuals.commissionGenerated, t.commissionGenerated),
  ];
  const cur = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const past20 = period < cur || (period === cur && new Date().getDate() > 20);
  if (pcts.every((p) => p >= 75)) return { dot: '🟢', label: 'On track' };
  if (past20 && pcts.some((p) => p < 50)) return { dot: '🔴', label: 'Behind' };
  return { dot: '🟡', label: 'Watch' };
}

function RmRow({ row, period }: { row: any; period: string }) {
  const s = rmStatus(row, period);
  const dPct = achievementPct(row.actuals.disbursalAmount, row.target?.targets.disbursalAmount ?? 0);
  const cPct = achievementPct(row.actuals.leadsConverted, row.target?.targets.leadsConverted ?? 0);
  return (
    <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <td className="px-2 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{row.rmName}</td>
      <td className="px-2 py-2" style={{ color: 'var(--shell-text-secondary)' }}>{fmtCompact(row.actuals.disbursalAmount)}/{fmtCompact(row.target?.targets.disbursalAmount ?? 0)} <b style={{ color: 'var(--text-primary)' }}>{dPct}%</b></td>
      <td className="px-2 py-2" style={{ color: 'var(--shell-text-secondary)' }}>{row.actuals.leadsConverted}/{row.target?.targets.leadsConverted ?? 0} <b style={{ color: 'var(--text-primary)' }}>{cPct}%</b></td>
      <td className="px-2 py-2 whitespace-nowrap">{s.dot} {s.label}</td>
    </tr>
  );
}

function RmCard({ row, period }: { row: any; period: string }) {
  const s = rmStatus(row, period);
  const dPct = achievementPct(row.actuals.disbursalAmount, row.target?.targets.disbursalAmount ?? 0);
  return (
    <div className="rounded-xl p-3" style={{ border: '1px solid var(--shell-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{row.rmName}</span>
        <span className="text-xs">{s.dot} {s.label}</span>
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--shell-text-dim)' }}>
        Disbursals {fmtCompact(row.actuals.disbursalAmount)}/{fmtCompact(row.target?.targets.disbursalAmount ?? 0)} ({dPct}%) · Conv {row.actuals.leadsConverted}/{row.target?.targets.leadsConverted ?? 0}
      </p>
    </div>
  );
}
