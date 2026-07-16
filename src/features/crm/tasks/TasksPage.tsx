import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, CalendarClock, ListChecks, ClipboardList, Plus, PhoneCall, AlarmClock, Check,
  List as ListIcon, CalendarDays, ChevronLeft, ChevronRight, Users as UsersIcon,
} from 'lucide-react';
import {
  collection, query, where, orderBy, limit, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { PageHeader } from '../../../components/ui/primitives';
import { MyQueuePage } from '../leads/MyQueuePage';
import { MyMeetingsPage } from '../meetings/MyMeetingsPage';
import { useMyMeetings } from '../hooks/useMeetings';
import { apiCrm2, hasCrm2Perm } from '../../crm2/lib';

type Tab = 'todo' | 'queue' | 'meetings' | 'cases';

type CaseTask = { id: string; caseId: string; clientName: string | null; text: string; createdByName: string; createdAt: number | null };

type CrmTask = {
  id: string; assignedTo: string; assignedToName: string; text: string;
  dueAt: Timestamp | null; link: string | null; status: 'open' | 'done';
  createdBy: string; createdByName: string; createdAt: Timestamp | null;
};

type Crm2LeadLite = {
  id: string; name?: string; leadCode?: string; status?: string; converted?: boolean;
  nextFollowUpAt?: Timestamp | null; nextFollowUpNote?: string | null;
  firstContactedAt?: Timestamp | null; receivedAt?: Timestamp | null;
};

type CallbackLead = { id: string; displayName?: string; callbackAt?: string | null };

const CRM2_TERMINAL = new Set(['NOT_INTERESTED', 'JUNK_DUPLICATE', 'DROPPED', 'CONVERTED']);

const fmtWhen = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

// Calendar item colours — one language across list chips + calendar dots + legend.
const KIND_META = {
  task:     { label: 'Task',      color: '#C9A961' },
  followup: { label: 'Follow-up', color: '#fbbf24' },
  callback: { label: 'Callback',  color: '#34d399' },
  meeting:  { label: 'Meeting',   color: '#60a5fa' },
} as const;
type CalKind = keyof typeof KIND_META;
type CalItem = { key: string; kind: CalKind; at: Date; label: string; sub?: string; link?: string; task?: CrmTask };

/**
 * TasksPage — unified workspace. The To-Do tab is the "what should I act on"
 * radar: your tasks, lead follow-ups and callbacks — as clean cards or a
 * month calendar.
 */
export function TasksPage() {
  const [tab, setTab] = useState<Tab>('todo');

  const TabBtn = ({ id, label, Icon }: { id: Tab; label: string; Icon: typeof Inbox }) => (
    <button onClick={() => setTab(id)}
      className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors"
      style={tab === id
        ? { backgroundColor: 'rgba(201,169,97,0.14)', color: '#C9A961' }
        : { color: 'var(--text-muted)' }}>
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle="Your queue, meetings, case tasks and follow-ups in one place."
        pinKey="crm.tasks"
      />

      <div className="flex items-center gap-1.5 flex-wrap p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
        <TabBtn id="todo" label="To-Do" Icon={ClipboardList} />
        <TabBtn id="queue" label="My Queue" Icon={Inbox} />
        <TabBtn id="meetings" label="Meetings" Icon={CalendarClock} />
        <TabBtn id="cases" label="Case Tasks" Icon={ListChecks} />
      </div>

      <div>
        {tab === 'todo' ? <ToDoSection />
          : tab === 'queue' ? <MyQueuePage />
          : tab === 'meetings' ? <MyMeetingsPage />
          : <CaseTasksSection />}
      </div>
    </div>
  );
}

// ─── To-Do — quick-add + my tasks / assigned-by-me + follow-ups + calendar ────

function ToDoSection() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const uid = user?.uid ?? '';
  const myFapl = profile?.employeeId ?? '';
  const canAssignOthers = profile?.role === 'admin' || profile?.crmRole === 'manager' || isSuperAdmin(uid, profile);
  const canReadCrm2Leads = profile?.role === 'admin' || hasCrm2Perm(profile, 'crm.leads.read');

  const [view, setView] = useState<'list' | 'calendar'>('list');

  // ── Data: tasks assigned to me / by me (live) ───────────────────────────────
  const [myTasks, setMyTasks] = useState<CrmTask[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'crm_tasks'), where('assignedTo', '==', uid));
    return onSnapshot(q, (snap) => {
      setMyTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CrmTask));
    }, () => setMyTasks([]));
  }, [uid]);

  const [givenTasks, setGivenTasks] = useState<CrmTask[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'crm_tasks'), where('createdBy', '==', uid));
    return onSnapshot(q, (snap) => {
      setGivenTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CrmTask));
    }, () => setGivenTasks([]));
  }, [uid]);

  // ── Data: my CRM 2.0 leads (follow-ups + first contact) ─────────────────────
  const [crm2Leads, setCrm2Leads] = useState<Crm2LeadLite[]>([]);
  useEffect(() => {
    if (!myFapl || !canReadCrm2Leads) return;
    const q = query(collection(db, 'leads'),
      where('assignedRm', '==', myFapl), orderBy('receivedAt', 'desc'), limit(300));
    return onSnapshot(q, (snap) => {
      setCrm2Leads(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Crm2LeadLite));
    }, () => setCrm2Leads([]));
  }, [myFapl, canReadCrm2Leads]);

  // ── Data: my old-CRM customer callbacks ─────────────────────────────────────
  const [callbackLeads, setCallbackLeads] = useState<CallbackLead[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'leads'),
      where('primaryOwnerId', '==', uid), where('leadStatus', '==', 'callback'));
    return onSnapshot(q, (snap) => {
      setCallbackLeads(snap.docs
        .filter((d) => d.data().deleted !== true)
        .map((d) => ({ id: d.id, ...d.data() }) as CallbackLead));
    }, () => setCallbackLeads([]));
  }, [uid]);

  // ── Data: my meetings (for the calendar) ────────────────────────────────────
  const { meetings } = useMyMeetings(uid || null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const now = Date.now();

  // "My tasks" = everything assigned to me (incl. self-created — shown ONCE here).
  const openMine = useMemo(() =>
    myTasks.filter((t) => t.status === 'open')
      .sort((a, b) => (a.dueAt?.toMillis() ?? Infinity) - (b.dueAt?.toMillis() ?? Infinity)
        || (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [myTasks]);
  // "Assigned by me" = tasks I gave to OTHERS (self-assigned live under My tasks).
  const openGiven = useMemo(() =>
    givenTasks.filter((t) => t.status === 'open' && t.assignedTo !== uid)
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [givenTasks, uid]);

  const activeCrm2 = useMemo(() =>
    crm2Leads.filter((l) => l.converted !== true && !CRM2_TERMINAL.has(l.status ?? '')),
    [crm2Leads]);
  const followUpsDue = useMemo(() =>
    activeCrm2.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt.toMillis() <= now + 48 * 3600_000)
      .sort((a, b) => (a.nextFollowUpAt!.toMillis()) - (b.nextFollowUpAt!.toMillis())),
    [activeCrm2, now]);
  const awaitingFirstContact = useMemo(() =>
    activeCrm2.filter((l) => !l.firstContactedAt && (l.status === 'NEW' || l.status === 'ASSIGNED'))
      .sort((a, b) => (a.receivedAt?.toMillis() ?? 0) - (b.receivedAt?.toMillis() ?? 0)),
    [activeCrm2]);
  const dueCallbacks = useMemo(() =>
    callbackLeads.filter((l) => l.callbackAt)
      .sort((a, b) => new Date(a.callbackAt!).getTime() - new Date(b.callbackAt!).getTime()),
    [callbackLeads]);

  // Everything with a date/time → the calendar's items.
  const calItems = useMemo<CalItem[]>(() => {
    const items: CalItem[] = [];
    for (const t of openMine) {
      if (t.dueAt) items.push({
        key: `t_${t.id}`, kind: 'task', at: t.dueAt.toDate(), label: t.text,
        sub: t.createdBy === uid ? 'my task' : `from ${t.createdByName}`, task: t,
      });
    }
    for (const t of openGiven) {
      if (t.dueAt) items.push({
        key: `g_${t.id}`, kind: 'task', at: t.dueAt.toDate(), label: t.text,
        sub: `to ${t.assignedToName}`, task: t,
      });
    }
    for (const l of activeCrm2) {
      if (l.nextFollowUpAt) items.push({
        key: `f_${l.id}`, kind: 'followup', at: l.nextFollowUpAt.toDate(),
        label: l.name ?? l.leadCode ?? l.id, sub: l.nextFollowUpNote ?? 'lead follow-up',
        link: '/crm/pipeline/leads',
      });
    }
    for (const l of dueCallbacks) {
      items.push({
        key: `c_${l.id}`, kind: 'callback', at: new Date(l.callbackAt!),
        label: l.displayName ?? l.id, sub: 'customer callback', link: `/crm/leads/${l.id}`,
      });
    }
    for (const m of meetings) {
      if (m.status !== 'scheduled') continue;
      items.push({
        key: `m_${m.id}`, kind: 'meeting', at: new Date(m.startAt),
        label: m.title || m.leadName || 'Meeting', sub: m.leadName ?? undefined,
        link: m.leadId ? `/crm/leads/${m.leadId}` : undefined,
      });
    }
    return items.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [openMine, openGiven, activeCrm2, dueCallbacks, meetings, uid]);

  const [busyId, setBusyId] = useState('');
  const setTaskStatus = async (t: CrmTask, status: 'open' | 'done') => {
    setBusyId(t.id);
    try {
      await apiCrm2('PATCH', `/api/crm2/tasks/${t.id}`, { status });
      toast.success(status === 'done' ? 'Done ✓' : 'Task reopened');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update task');
    } finally { setBusyId(''); }
  };

  const nothingToDo = openMine.length === 0 && openGiven.length === 0 && followUpsDue.length === 0
    && awaitingFirstContact.length === 0 && dueCallbacks.length === 0;

  return (
    <div className="space-y-6">
      {/* Quick add — one line, anyone can add for themselves; managers pick a person */}
      <QuickAddTask uid={uid} canAssignOthers={canAssignOthers} />

      {/* View toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
          {([['list', 'List', ListIcon], ['calendar', 'Calendar', CalendarDays]] as const).map(([v, lbl, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
              style={view === v
                ? { backgroundColor: 'var(--ss-bg)', color: '#C9A961', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                : { color: 'var(--text-muted)' }}>
              <Icon size={13} /> {lbl}
            </button>
          ))}
        </div>
        {view === 'calendar' && (
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {(Object.keys(KIND_META) as CalKind[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_META[k].color }} />
                {KIND_META[k].label}
              </span>
            ))}
          </div>
        )}
      </div>

      {view === 'calendar' ? (
        <TasksCalendar items={calItems} busyId={busyId} onToggleTask={setTaskStatus} />
      ) : nothingToDo ? (
        <div className="glass-panel p-10 text-center">
          <p className="text-2xl mb-2">🎉</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing pending. Add a task above, or check the Calendar for what's coming up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* LEFT column — tasks */}
          <div className="space-y-5">
            {openMine.length > 0 && (
              <CardSection Icon={ClipboardList} label="My tasks" count={openMine.length} color="#C9A961">
                {openMine.map((t) => (
                  <TaskCard key={t.id} t={t} me={uid} busy={busyId === t.id} now={now}
                    onDone={() => void setTaskStatus(t, 'done')} />
                ))}
              </CardSection>
            )}
            {openGiven.length > 0 && (
              <CardSection Icon={UsersIcon} label="Assigned by me" count={openGiven.length} color="#8B5CF6">
                {openGiven.map((t) => (
                  <TaskCard key={t.id} t={t} me={uid} busy={busyId === t.id} now={now}
                    onDone={() => void setTaskStatus(t, 'done')} />
                ))}
              </CardSection>
            )}
          </div>

          {/* RIGHT column — leads needing action */}
          <div className="space-y-5">
            {followUpsDue.length > 0 && (
              <CardSection Icon={AlarmClock} label="Lead follow-ups due" count={followUpsDue.length} color="#fbbf24">
                {followUpsDue.map((l) => {
                  const at = l.nextFollowUpAt!.toDate();
                  const overdue = at.getTime() < now;
                  return (
                    <LinkCard key={l.id} to="/crm/pipeline/leads" overdue={overdue}
                      icon={<AlarmClock size={15} style={{ color: overdue ? '#f87171' : '#fbbf24' }} />}
                      title={l.name ?? l.leadCode ?? l.id}
                      sub={`Follow up ${overdue ? 'was due' : 'due'} ${fmtWhen(at)}${l.nextFollowUpNote ? ` — ${l.nextFollowUpNote}` : ''}`}
                      subColor={overdue ? '#f87171' : undefined} />
                  );
                })}
              </CardSection>
            )}
            {awaitingFirstContact.length > 0 && (
              <CardSection Icon={PhoneCall} label="New leads — make the first call" count={awaitingFirstContact.length} color="#60a5fa">
                {awaitingFirstContact.slice(0, 10).map((l) => (
                  <LinkCard key={l.id} to="/crm/pipeline/leads"
                    icon={<PhoneCall size={15} style={{ color: '#60a5fa' }} />}
                    title={l.name ?? l.leadCode ?? l.id}
                    sub={`Assigned to you${l.receivedAt ? ` · received ${fmtWhen(l.receivedAt.toDate())}` : ''}`} />
                ))}
                {awaitingFirstContact.length > 10 && (
                  <Link to="/crm/pipeline/leads" className="block text-center text-xs py-2 underline" style={{ color: 'var(--text-muted)' }}>
                    +{awaitingFirstContact.length - 10} more on the Leads page →
                  </Link>
                )}
              </CardSection>
            )}
            {dueCallbacks.length > 0 && (
              <CardSection Icon={PhoneCall} label="Customer callbacks" count={dueCallbacks.length} color="#34d399">
                {dueCallbacks.map((l) => {
                  const at = new Date(l.callbackAt!);
                  const overdue = at.getTime() < now;
                  return (
                    <LinkCard key={l.id} to={`/crm/leads/${l.id}`} overdue={overdue}
                      icon={<PhoneCall size={15} style={{ color: overdue ? '#f87171' : '#34d399' }} />}
                      title={l.displayName ?? l.id}
                      sub={`Callback ${overdue ? 'was due' : 'scheduled'} ${fmtWhen(at)}`}
                      subColor={overdue ? '#f87171' : undefined} />
                  );
                })}
              </CardSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quick add — one line, Enter to save ──────────────────────────────────────

function QuickAddTask({ uid, canAssignOthers }: { uid: string; canAssignOthers: boolean }) {
  const toast = useToast();
  const { employees } = useAllEmployees(canAssignOthers);
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [forUid, setForUid] = useState('');     // '' = myself
  const [saving, setSaving] = useState(false);

  const options = [
    { value: '', label: 'Myself' },
    ...employees
      .filter((e) => e.userId !== uid && (!e.employeeStatus || e.employeeStatus === 'active'))
      .map((e) => ({ value: e.userId, label: e.displayName })),
  ];

  const submit = async () => {
    if (text.trim().length < 3) { toast.error('Type the task first'); return; }
    setSaving(true);
    try {
      await apiCrm2('POST', '/api/crm2/tasks', {
        assignedTo: forUid || uid,
        text: text.trim(),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      toast.success(forUid ? 'Task assigned — they\'ve been notified' : 'Task added');
      setText(''); setDueAt(''); setForUid('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the task');
    } finally { setSaving(false); }
  };

  return (
    <div className="glass-panel p-3 flex flex-wrap items-center gap-2">
      <Plus size={16} className="shrink-0 ml-1" style={{ color: '#C9A961' }} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void submit(); }}
        placeholder="Add a task… e.g. Call Sharma about the HL documents"
        className="flex-1 min-w-[180px] text-sm px-2 py-2 rounded-lg outline-none"
        style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
      />
      <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
        title="Due date & time (optional)"
        className="text-xs px-2.5 py-2 rounded-lg outline-none"
        style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }} />
      {canAssignOthers && (
        <div className="w-44">
          <SearchableSelect options={options} value={forUid} onChange={setForUid} placeholder="For: Myself" />
        </div>
      )}
      <button onClick={() => void submit()} disabled={saving}
        className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {saving ? 'Adding…' : 'Add'}
      </button>
    </div>
  );
}

// ─── Card primitives ──────────────────────────────────────────────────────────

function CardSection({ Icon, label, count, color, children }: {
  Icon: typeof Inbox; label: string; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} style={{ color }} />
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${color}22`, color }}>{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TaskCard({ t, me, busy, now, onDone }: { t: CrmTask; me: string; busy: boolean; now: number; onDone: () => void }) {
  const overdue = t.dueAt != null && t.dueAt.toMillis() < now;
  const mineByMe = t.createdBy === me && t.assignedTo === me;
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl transition-colors"
      style={{
        backgroundColor: 'var(--shell-hover-soft)',
        border: `1px solid ${overdue ? 'rgba(248,113,113,0.45)' : 'var(--shell-border)'}`,
      }}>
      <button onClick={onDone} disabled={busy} title="Mark done"
        className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110 disabled:opacity-40 group"
        style={{ borderColor: overdue ? '#f87171' : '#C9A961' }}>
        <Check size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#34d399' }} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{t.text}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {mineByMe ? 'my task' : t.assignedTo === me ? `from ${t.createdByName}` : `to ${t.assignedToName}`}
          {t.dueAt && (
            <span className="font-medium" style={{ color: overdue ? '#f87171' : '#C9A961' }}>
              {' '}· {overdue ? 'OVERDUE — was due' : 'due'} {fmtWhen(t.dueAt.toDate())}
            </span>
          )}
          {t.link && <> · <Link to={t.link} className="underline" style={{ color: '#C9A961' }}>open →</Link></>}
        </p>
      </div>
    </div>
  );
}

function LinkCard({ to, icon, title, sub, subColor, overdue }: {
  to: string; icon: React.ReactNode; title: string; sub: string; subColor?: string; overdue?: boolean;
}) {
  return (
    <Link to={to}
      className="flex items-start gap-3 p-3 rounded-xl transition-colors hover:bg-(--shell-hover-hard)"
      style={{
        backgroundColor: 'var(--shell-hover-soft)',
        border: `1px solid ${overdue ? 'rgba(248,113,113,0.45)' : 'var(--shell-border)'}`,
      }}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>{title}</p>
        <p className="text-[11px] mt-0.5" style={{ color: subColor ?? 'var(--text-muted)' }}>{sub}</p>
      </div>
      <span className="shrink-0 text-[11px] font-semibold mt-0.5" style={{ color: '#C9A961' }}>Open →</span>
    </Link>
  );
}

// ─── Month calendar — tasks, follow-ups, callbacks, meetings by date ──────────

function TasksCalendar({ items, busyId, onToggleTask }: {
  items: CalItem[]; busyId: string; onToggleTask: (t: CrmTask, status: 'open' | 'done') => Promise<void>;
}) {
  const today = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: today.getFullYear(), m: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState<string>(dayKey(today));

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const it of items) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return map;
  }, [items]);

  // Mon-start month grid
  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(ym.y, ym.m, d));
    while (out.length % 7) out.push(null);
    return out;
  }, [ym]);

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const todayKey = dayKey(today);
  const dayItems = byDay.get(selectedDay) ?? [];

  const nav = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4">
        {/* Month header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{monthLabel}</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setYm({ y: today.getFullYear(), m: today.getMonth() }); setSelectedDay(todayKey); }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
              Today
            </button>
            <button onClick={() => nav(-1)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><ChevronLeft size={16} style={{ color: 'var(--text-muted)' }} /></button>
            <button onClick={() => nav(1)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><ChevronRight size={16} style={{ color: 'var(--text-muted)' }} /></button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 mb-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider py-1" style={{ color: 'var(--text-dim)' }}>{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="min-h-16 rounded-lg" />;
            const k = dayKey(d);
            const its = byDay.get(k) ?? [];
            const isToday = k === todayKey;
            const isSelected = k === selectedDay;
            return (
              <button key={k} onClick={() => setSelectedDay(k)}
                className="min-h-16 rounded-lg p-1 text-left align-top transition-colors hover:bg-(--shell-hover-hard)"
                style={{
                  backgroundColor: isSelected ? 'rgba(201,169,97,0.12)' : 'var(--shell-hover-soft)',
                  border: isToday ? '1.5px solid #C9A961' : `1px solid ${isSelected ? 'rgba(201,169,97,0.5)' : 'var(--shell-border)'}`,
                }}>
                <span className="text-[11px] font-semibold block mb-0.5"
                  style={{ color: isToday ? '#C9A961' : 'var(--text-muted)' }}>
                  {d.getDate()}
                </span>
                <span className="flex flex-wrap gap-0.5">
                  {its.slice(0, 4).map((it) => (
                    <span key={it.key} className="w-1.5 h-1.5 rounded-full" title={`${KIND_META[it.kind].label}: ${it.label}`}
                      style={{ backgroundColor: KIND_META[it.kind].color }} />
                  ))}
                  {its.length > 4 && <span className="text-[9px] leading-none" style={{ color: 'var(--text-dim)' }}>+{its.length - 4}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day detail */}
      <div className="glass-panel p-4">
        <h4 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          {new Date(selectedDay).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h4>
        {dayItems.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
            Nothing scheduled this day.
          </p>
        ) : (
          <div className="space-y-2">
            {dayItems.map((it) => (
              <div key={it.key} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
                <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: KIND_META[it.kind].color }} />
                <span className="shrink-0 text-xs font-semibold w-16" style={{ color: 'var(--text-muted)' }}>
                  {it.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{it.label}</p>
                  {it.sub && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{KIND_META[it.kind].label} · {it.sub}</p>}
                </div>
                {it.task ? (
                  <button onClick={() => void onToggleTask(it.task!, 'done')} disabled={busyId === it.task.id}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                    style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                    ✓ Done
                  </button>
                ) : it.link ? (
                  <Link to={it.link} className="shrink-0 text-[11px] font-semibold" style={{ color: '#C9A961' }}>Open →</Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Case tasks (Phase 6 collaboration threads) ───────────────────────────────

function CaseTasksSection() {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    apiCrm2<{ ok: boolean; tasks: CaseTask[] }>('GET', '/api/crm2/my-case-tasks')
      .then((r) => { if (!cancel) { setTasks(r.tasks ?? []); setLoading(false); } })
      .catch((e) => { if (!cancel) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
    return () => { cancel = true; };
  }, []);

  if (loading) return <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  if (error) return <div className="glass-panel p-6 text-sm" style={{ color: 'var(--text-muted)' }}>{error}</div>;
  if (tasks.length === 0) {
    return (
      <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No open case tasks assigned to you. Tasks teammates assign you on a shared case appear here.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <Link key={t.id} to={`/crm/pipeline/cases/${t.caseId}`}
          className="glass-panel p-3.5 flex items-start gap-3 hover:bg-(--shell-hover-soft) transition-colors">
          <ListChecks size={16} className="shrink-0 mt-0.5" style={{ color: '#C9A961' }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{t.text}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t.clientName ?? t.caseId} · {t.caseId} · by {t.createdByName}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
