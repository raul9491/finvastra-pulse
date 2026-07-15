/**
 * MyActivityPage — /crm/my-activity — the outbound-call activity view.
 *
 * The layer BEFORE the business numbers: tagged → attempted → outcome.
 *  · Every CRM user sees their OWN month: customers tagged to them (and when the
 *    data arrived), calls/touches made, the statuses they set, and which tagged
 *    customers are still untouched — with drill-downs (call log + untouched list).
 *  · A CRM manager can switch the view to anyone in their team; admins/super
 *    admins to anyone. The server enforces the same rule, so the picker is
 *    convenience, not security.
 *
 * Data: GET /api/crm/activity/summary?period&uid (Admin SDK aggregation over the
 * person's owned leads + their logged activities). Deterministic — no AI.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PhoneCall, Users, CheckCircle2, AlertTriangle, RefreshCw,
  MessageCircle, Mail, CalendarClock, StickyNote, ArrowRight,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { PageHeader, StatCard, Card, Section } from '../../../components/ui/primitives';
import { ReBar, RePie } from '../../../components/ui/charts';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:            { label: 'Not yet actioned', color: '#94a3b8' },
  interested:     { label: 'Interested',       color: '#34d399' },
  callback:       { label: 'Callback later',   color: '#C9A961' },
  no_response:    { label: 'No response',      color: '#fbbf24' },
  not_interested: { label: 'Not interested',   color: '#f87171' },
  wrong_number:   { label: 'Wrong number',     color: '#ef4444' },
  not_eligible:   { label: 'Not eligible',     color: '#fb7185' },
  converted:      { label: 'Converted',        color: '#10b981' },
};
const STATUS_ORDER = ['interested', 'callback', 'converted', 'no_response', 'not_interested', 'wrong_number', 'not_eligible', 'new'];

const TYPE_META: Record<string, { label: string; Icon: typeof PhoneCall; color: string }> = {
  call:          { label: 'Call',     Icon: PhoneCall,     color: '#C9A961' },
  whatsapp:      { label: 'WhatsApp', Icon: MessageCircle, color: '#25D366' },
  email:         { label: 'Email',    Icon: Mail,          color: '#5B9BD5' },
  meeting:       { label: 'Meeting',  Icon: CalendarClock, color: '#8B5CF6' },
  note:          { label: 'Note',     Icon: StickyNote,    color: '#94a3b8' },
  status_change: { label: 'Status',   Icon: ArrowRight,    color: '#94a3b8' },
};

interface Summary {
  period: string; uid: string; name: string;
  importFilter: string | null; importNames: string[];
  tagged: number; taggedInPeriod: number; attempted: number;
  status: Record<string, number>;
  untouchedCount: number;
  untouched: Array<{ leadId: string; name: string; taggedAtMs: number | null; importName: string | null }>;
  byType: Record<string, number>; totalTouches: number; uniqueCustomersTouched: number;
  daily: Array<{ date: string; count: number }>;
  recent: Array<{ leadId: string | null; leadName: string; type: string; atMs: number; content: string }>;
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtAt = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export function MyActivityPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'log' | 'untouched'>(() => (searchParams.get('view') === 'untouched' ? 'untouched' : 'log'));
  const [people, setPeople] = useState<Array<{ uid: string; name: string; mgr?: string }>>([]);
  const [importFilter, setImportFilter] = useState('');

  const isAdmin = profile?.role === 'admin' || (user ? isSuperAdmin(user.uid, profile) : false);
  const isManager = profile?.crmRole === 'manager';
  const viewUid = searchParams.get('uid') ?? '';

  // Viewer picker (managers → their downline; admins → everyone active).
  // The users collection is readable by any signed-in user (directory), and the
  // server re-checks the relationship — this list is convenience only.
  useEffect(() => {
    if (!user || (!isAdmin && !isManager)) return;
    getDocs(collection(db, 'users')).then((snap) => {
      const all = snap.docs
        .map((d) => ({ uid: d.id, name: (d.data() as any).displayName ?? '—', mgr: (d.data() as any).reportingManagerUid as string | undefined, inactive: (d.data() as any).employeeStatus === 'inactive' }))
        .filter((u) => !u.inactive);
      if (isAdmin) { setPeople(all); return; }
      // manager: transitive downline
      const childrenOf = new Map<string, string[]>();
      all.forEach((u) => { if (u.mgr) { if (!childrenOf.has(u.mgr)) childrenOf.set(u.mgr, []); childrenOf.get(u.mgr)!.push(u.uid); } });
      const team = new Set<string>();
      const stack = [...(childrenOf.get(user.uid) ?? [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (team.has(id) || id === user.uid) continue;
        team.add(id);
        (childrenOf.get(id) ?? []).forEach((c) => stack.push(c));
      }
      setPeople(all.filter((u) => team.has(u.uid)));
    }).catch(() => setPeople([]));
  }, [user, isAdmin, isManager]);

  const load = useCallback(async (p: string, forUid: string, imp: string) => {
    setLoading(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const uidParam = forUid ? `&uid=${forUid}` : '';
      const impParam = imp ? `&importName=${encodeURIComponent(imp)}` : '';
      const res = await fetch(`/api/crm/activity/summary?period=${p}${uidParam}${impParam}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) throw new Error('You can only view your own activity (or your team’s, as a manager).');
      if (!res.ok) throw new Error(`Could not load activity (HTTP ${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) void load(period, viewUid, importFilter); }, [user, period, viewUid, importFilter, load]);
  // Reset the import filter when switching person — their imports differ.
  useEffect(() => { setImportFilter(''); }, [viewUid]);

  const statusChips = useMemo(() => {
    if (!data) return [];
    return STATUS_ORDER.map((k) => ({ key: k, count: data.status[k] ?? 0, ...STATUS_META[k] })).filter((s) => s.count > 0);
  }, [data]);

  const pieData = useMemo(() => statusChips.map((s) => ({ name: s.label, value: s.count })), [statusChips]);
  const pieColors = useMemo(() => statusChips.map((s) => s.color), [statusChips]);
  const dailyData = useMemo(
    () => (data?.daily ?? []).map((d) => ({ day: fmtDay(d.date), count: d.count })),
    [data],
  );

  const viewingSelf = !viewUid || viewUid === user?.uid;
  const attemptPct = data && data.tagged > 0 ? Math.round((data.attempted / data.tagged) * 100) : 0;

  const headerActions = (
    <>
          <div className="flex flex-wrap items-center gap-2">
            {(isAdmin || isManager) && people.length > 0 && (
              <div className="w-52">
                <SearchableSelect
                  value={viewUid}
                  onChange={(v) => setSearchParams(v ? { uid: v } : {}, { replace: true })}
                  options={[{ value: '', label: 'Myself' }, ...people.map((p) => ({ value: p.uid, label: p.name }))]}
                  placeholder="View person…"
                />
              </div>
            )}
            {(data?.importNames.length ?? 0) > 0 && (
              <div className="w-52">
                <SearchableSelect
                  value={importFilter}
                  onChange={setImportFilter}
                  options={[{ value: '', label: 'All data sources' }, ...(data?.importNames ?? []).map((n) => ({ value: n, label: n }))]}
                  placeholder="Filter by import…"
                />
              </div>
            )}
            <input
              type="month" value={period} max={new Date().toISOString().slice(0, 7)}
              onChange={(e) => setPeriod(e.target.value)}
              className="glass-inp text-sm px-3 py-2 rounded-lg"
            />
            <button onClick={() => void load(period, viewUid, importFilter)} className="p-2 rounded-lg" style={{ color: 'var(--text-muted)' }} title="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
    </>
  );

  return (
    <div className={embedded ? '' : 'max-w-6xl mx-auto'}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {viewingSelf ? '' : `Viewing ${data?.name ?? '…'} · `}
            {importFilter
              ? `Only customers from the import "${importFilter}".`
              : 'Tagged → attempted → outcome for the selected month.'}
          </p>
          {headerActions}
        </div>
      ) : (
        <PageHeader
          title={viewingSelf ? 'My Activity' : `Activity — ${data?.name ?? '…'}`}
          subtitle={importFilter
            ? `Showing only customers from the import "${importFilter}".`
            : 'Tagged → attempted → outcome. Calls made this month, the statuses set, and which customers are still waiting.'}
          pinKey="crm.performance"
          actions={headerActions}
        />
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
          {error}
        </div>
      )}

      {/* KPI strip — the tagged→attempted funnel at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<Users size={17} />} label="Customers tagged" loading={loading}
          value={data?.tagged ?? 0} sub={`+${data?.taggedInPeriod ?? 0} received this month`} accent="#5B9BD5" />
        <StatCard icon={<PhoneCall size={17} />} label="Calls / touches this month" loading={loading}
          value={data?.totalTouches ?? 0}
          sub={data ? `${data.byType.call} calls · ${data.byType.whatsapp} WhatsApp · ${data.byType.email} email · ${data.byType.meeting} meetings` : undefined}
          accent="#C9A961" />
        <StatCard icon={<CheckCircle2 size={17} />} label="Customers attempted" loading={loading}
          value={data?.attempted ?? 0} sub={data ? `${attemptPct}% of tagged · ${data.uniqueCustomersTouched} touched this month` : undefined}
          accent="#34A853" />
        <StatCard icon={<AlertTriangle size={17} />} label="Untouched" loading={loading}
          value={data?.untouchedCount ?? 0} sub="tagged but never contacted" accent="#EF4444"
          onClick={() => setTab('untouched')} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <Section label="Calls per day (this month)">
            <ReBar data={dailyData} xKey="day" series={[{ key: 'count', name: 'Touches', color: '#C9A961' }]} height={220}
              empty="No calls logged this month yet." />
          </Section>
        </Card>
        <Card>
          <Section label="What the customers answered (status set)">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {statusChips.map((s) => (
                <span key={s.key} className="text-[11px] font-semibold px-2 py-1 rounded-full"
                  style={{ color: s.color, backgroundColor: `${s.color}1f`, border: `1px solid ${s.color}44` }}>
                  {s.label} · {s.count}
                </span>
              ))}
              {!loading && statusChips.length === 0 && (
                <span className="text-sm" style={{ color: 'var(--text-dim)' }}>No customers tagged yet.</span>
              )}
            </div>
            <RePie data={pieData} colors={pieColors} height={190} empty="No statuses set yet." />
          </Section>
        </Card>
      </div>

      {/* Drill-down: call log / untouched customers */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          {([['log', `Call log (${data?.recent.length ?? 0})`], ['untouched', `Untouched customers (${data?.untouchedCount ?? 0})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              style={tab === k
                ? { backgroundColor: '#0B1538', color: '#E5C97C' }
                : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'log' && (
          <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
            {(data?.recent ?? []).map((r, i) => {
              const m = TYPE_META[r.type] ?? TYPE_META.note;
              return (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${m.color}1f`, color: m.color }}>
                    <m.Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {r.leadId
                        ? <Link to={`/crm/leads/${r.leadId}`} className="hover:underline">{r.leadName}</Link>
                        : r.leadName}
                      <span className="ml-2 text-[11px] font-semibold" style={{ color: m.color }}>{m.label}</span>
                    </p>
                    {r.content && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{r.content}</p>}
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-dim)' }}>{fmtAt(r.atMs)}</span>
                </div>
              );
            })}
            {!loading && (data?.recent.length ?? 0) === 0 && (
              <p className="py-6 text-sm text-center" style={{ color: 'var(--text-dim)' }}>
                No activity logged this month. Calls logged from a customer page (or My Queue) appear here.
              </p>
            )}
          </div>
        )}

        {tab === 'untouched' && (
          <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
            {(data?.untouched ?? []).map((u) => (
              <div key={u.leadId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link to={`/crm/leads/${u.leadId}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>{u.name}</Link>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {u.importName ? `From import "${u.importName}"` : 'Added manually'}
                    {u.taggedAtMs ? ` · tagged ${fmtAt(u.taggedAtMs)}` : ''}
                  </p>
                </div>
                <Link to={`/crm/leads/${u.leadId}`} className="text-xs font-semibold shrink-0" style={{ color: '#C9A961' }}>Open →</Link>
              </div>
            ))}
            {!loading && (data?.untouchedCount ?? 0) === 0 && (
              <p className="py-6 text-sm text-center" style={{ color: 'var(--text-dim)' }}>
                Nothing untouched — every tagged customer has been actioned. 🎉
              </p>
            )}
            {(data?.untouchedCount ?? 0) > (data?.untouched.length ?? 0) && (
              <p className="py-2 text-xs text-center" style={{ color: 'var(--text-dim)' }}>
                Showing the oldest {data?.untouched.length} of {data?.untouchedCount} — work these first.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
