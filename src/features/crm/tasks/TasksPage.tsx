import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, CalendarClock, ListChecks, ClipboardList, Plus, PhoneCall, AlarmClock, Check,
  List as ListIcon, CalendarDays, ChevronLeft, ChevronRight, Users as UsersIcon,
  CheckSquare, X, Search,
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

type TaskItem = { id: string; text: string; done: boolean };
type CrmTask = {
  id: string; assignedTo: string; assignedToName: string; text: string;
  title?: string | null; color?: string | null; items?: TaskItem[] | null;
  dueAt: Timestamp | null; link: string | null; status: 'open' | 'done';
  createdBy: string; createdByName: string; createdAt: Timestamp | null;
  editedAt?: Timestamp | null;
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
// Default due = TODAY 6 pm — every new task is dated the day it was created.
const defaultDue = () => `${format(new Date(), 'yyyy-MM-dd')}T18:00`;

// Google-Keep-style colour accents — rgba tints so both themes stay readable.
const KEEP_COLORS: Record<string, { bg: string; dot: string }> = {
  default: { bg: 'var(--shell-hover-soft)', dot: 'var(--shell-border-mid)' },
  red:     { bg: 'rgba(244,63,94,0.13)',    dot: '#f43f5e' },
  orange:  { bg: 'rgba(249,115,22,0.13)',   dot: '#f97316' },
  yellow:  { bg: 'rgba(234,179,8,0.13)',    dot: '#eab308' },
  green:   { bg: 'rgba(52,211,153,0.12)',   dot: '#34d399' },
  teal:    { bg: 'rgba(20,184,166,0.13)',   dot: '#14b8a6' },
  blue:    { bg: 'rgba(96,165,250,0.13)',   dot: '#60a5fa' },
  purple:  { bg: 'rgba(139,92,246,0.13)',   dot: '#8b5cf6' },
};
const colorOf = (c?: string | null) => KEEP_COLORS[c ?? 'default'] ?? KEEP_COLORS.default;

// Calendar item colours — one language across chips + dots + legend.
const KIND_META = {
  task:     { label: 'Task',      color: '#C9A961' },
  followup: { label: 'Follow-up', color: '#fbbf24' },
  callback: { label: 'Callback',  color: '#34d399' },
  meeting:  { label: 'Meeting',   color: '#60a5fa' },
} as const;
type CalKind = keyof typeof KIND_META;
type CalItem = { key: string; kind: CalKind; at: Date; label: string; sub?: string; link?: string; task?: CrmTask };

/**
 * TasksPage — unified workspace. The To-Do tab is a Google-Keep-style board:
 * colour note cards with optional checklists, quick capture (due today by
 * default), due-time reminders (bell + email via the 15-min sweep), plus lead
 * follow-ups/callbacks and a month calendar.
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

// ─── To-Do — Keep board + follow-ups + calendar ───────────────────────────────

function ToDoSection() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const uid = user?.uid ?? '';
  const myFapl = profile?.employeeId ?? '';
  const canAssignOthers = profile?.role === 'admin' || profile?.crmRole === 'manager' || isSuperAdmin(uid, profile);
  const canReadCrm2Leads = profile?.role === 'admin' || hasCrm2Perm(profile, 'crm.leads.read');

  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [search, setSearch] = useState('');
  const [editTask, setEditTask] = useState<CrmTask | null>(null);

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

  // "My tasks" = everything assigned to me (a self-created task shows ONCE here).
  const openMine = useMemo(() =>
    myTasks.filter((t) => t.status === 'open')
      .sort((a, b) => (a.dueAt?.toMillis() ?? Infinity) - (b.dueAt?.toMillis() ?? Infinity)
        || (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [myTasks]);
  // "Assigned by me" = tasks I gave to OTHERS.
  const openGiven = useMemo(() =>
    givenTasks.filter((t) => t.status === 'open' && t.assignedTo !== uid)
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [givenTasks, uid]);

  // Search across everything on the board (title, text, checklist, people).
  const q = search.trim().toLowerCase();
  const hit = (t: CrmTask) => !q
    || (t.title ?? '').toLowerCase().includes(q)
    || t.text.toLowerCase().includes(q)
    || (t.items ?? []).some((i) => i.text.toLowerCase().includes(q))
    || t.createdByName.toLowerCase().includes(q)
    || t.assignedToName.toLowerCase().includes(q);
  // Three clear groups: given TO me by others - my own - given BY me.
  const mineFromOthers = openMine.filter((t) => t.createdBy !== uid).filter(hit);
  const mineSelf = openMine.filter((t) => t.createdBy === uid).filter(hit);
  const givenFiltered = openGiven.filter(hit);

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
        key: `t_${t.id}`, kind: 'task', at: t.dueAt.toDate(), label: t.title || t.text,
        sub: t.createdBy === uid ? 'my task' : `from ${t.createdByName}`, task: t,
      });
    }
    for (const t of openGiven) {
      if (t.dueAt) items.push({
        key: `g_${t.id}`, kind: 'task', at: t.dueAt.toDate(), label: t.title || t.text,
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
  const patchTask = async (id: string, body: Record<string, unknown>, okMsg?: string) => {
    setBusyId(id);
    try {
      await apiCrm2('PATCH', `/api/crm2/tasks/${id}`, body);
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update task');
    } finally { setBusyId(''); }
  };
  const setTaskStatus = (t: CrmTask, status: 'open' | 'done') =>
    patchTask(t.id, { status }, status === 'done' ? 'Done ✓' : 'Task reopened');

  const nothingToDo = openMine.length === 0 && openGiven.length === 0 && followUpsDue.length === 0
    && awaitingFirstContact.length === 0 && dueCallbacks.length === 0;

  return (
    <div className="space-y-6">
      {/* Keep-style composer */}
      <KeepComposer uid={uid} canAssignOthers={canAssignOthers} />

      {/* View toggle + search + legend */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
          {([['list', 'Board', ListIcon], ['calendar', 'Calendar', CalendarDays]] as const).map(([v, lbl, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
              style={view === v
                ? { backgroundColor: 'var(--ss-bg)', color: '#C9A961', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                : { color: 'var(--text-muted)' }}>
              <Icon size={13} /> {lbl}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-40 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..."
            className="w-full text-xs pl-8 pr-7 py-2 rounded-lg outline-none"
            style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X size={12} style={{ color: 'var(--text-dim)' }} />
            </button>
          )}
        </div>
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
            Nothing pending. Add a note or task above — it lands here as a card.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {q !== '' && mineFromOthers.length + mineSelf.length + givenFiltered.length === 0 && (
            <div className="glass-panel p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No tasks match your search.
            </div>
          )}

          {/* Assigned TO me by others — incoming work, always on top */}
          {mineFromOthers.length > 0 && (
            <div>
              <BoardHead Icon={Inbox} label="Assigned to me" count={mineFromOthers.length} color="#60a5fa" />
              <div className="columns-1 sm:columns-2 xl:columns-3 gap-3">
                {mineFromOthers.map((t) => (
                  <TaskKeepCard key={t.id} t={t} me={uid} busy={busyId === t.id} now={now}
                    onDone={() => void setTaskStatus(t, 'done')}
                    onPatch={(body) => void patchTask(t.id, body)}
                    onOpen={() => setEditTask(t)} />
                ))}
              </div>
            </div>
          )}

          {/* My own tasks */}
          {mineSelf.length > 0 && (
            <div>
              <BoardHead Icon={ClipboardList} label="My tasks" count={mineSelf.length} color="#C9A961" />
              <div className="columns-1 sm:columns-2 xl:columns-3 gap-3">
                {mineSelf.map((t) => (
                  <TaskKeepCard key={t.id} t={t} me={uid} busy={busyId === t.id} now={now}
                    onDone={() => void setTaskStatus(t, 'done')}
                    onPatch={(body) => void patchTask(t.id, body)}
                    onOpen={() => setEditTask(t)} />
                ))}
              </div>
            </div>
          )}

          {/* Assigned by me to others */}
          {givenFiltered.length > 0 && (
            <div>
              <BoardHead Icon={UsersIcon} label="Assigned by me" count={givenFiltered.length} color="#8B5CF6" />
              <div className="columns-1 sm:columns-2 xl:columns-3 gap-3">
                {givenFiltered.map((t) => (
                  <TaskKeepCard key={t.id} t={t} me={uid} busy={busyId === t.id} now={now}
                    onDone={() => void setTaskStatus(t, 'done')}
                    onPatch={(body) => void patchTask(t.id, body)}
                    onOpen={() => setEditTask(t)} />
                ))}
              </div>
            </div>
          )}

          {/* Leads needing action */}
          {(followUpsDue.length > 0 || awaitingFirstContact.length > 0 || dueCallbacks.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
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
              <div className="space-y-5">
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
              </div>
            </div>
          )}
        </div>
      )}

      {editTask && (
        <TaskEditModal task={editTask} busy={busyId === editTask.id}
          onSave={async (body) => { await patchTask(editTask.id, body, 'Saved'); setEditTask(null); }}
          onClose={() => setEditTask(null)} />
      )}
    </div>
  );
}

// ─── Keep composer — collapsed row → expanding note card ─────────────────────

function KeepComposer({ uid, canAssignOthers }: { uid: string; canAssignOthers: boolean }) {
  const toast = useToast();
  const { employees } = useAllEmployees(canAssignOthers);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [checklist, setChecklist] = useState(false);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [color, setColor] = useState('default');
  const [dueAt, setDueAt] = useState(defaultDue());
  const [forUid, setForUid] = useState('');
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const options = [
    { value: '', label: 'Myself' },
    ...employees
      .filter((e) => e.userId !== uid && (!e.employeeStatus || e.employeeStatus === 'active'))
      .map((e) => ({ value: e.userId, label: e.displayName })),
  ];

  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    seq.current += 1;
    setItems((p) => [...p, { id: `n${Date.now()}_${seq.current}`, text: t, done: false }]);
    setNewItem('');
  };

  const reset = () => {
    setOpen(false); setTitle(''); setText(''); setChecklist(false);
    setItems([]); setNewItem(''); setColor('default'); setDueAt(defaultDue()); setForUid('');
  };

  const submit = async () => {
    const list = checklist
      ? [...items, ...(newItem.trim() ? [{ id: `n${Date.now()}_x`, text: newItem.trim(), done: false }] : [])]
      : [];
    if (!title.trim() && !text.trim() && list.length === 0) { toast.error('Type something first'); return; }
    setSaving(true);
    try {
      await apiCrm2('POST', '/api/crm2/tasks', {
        assignedTo: forUid || uid,
        title: title.trim() || null,
        text: checklist ? '' : text.trim(),
        items: checklist ? list : null,
        color,
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      toast.success(forUid ? 'Task assigned — they\'ve been notified' : 'Added');
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add');
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <div className="glass-panel px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto cursor-text"
        onClick={() => setOpen(true)}>
        <Plus size={16} style={{ color: '#C9A961' }} />
        <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)' }}>Add a task or note…</span>
        <button onClick={(e) => { e.stopPropagation(); setChecklist(true); setOpen(true); }}
          title="New checklist" className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)">
          <CheckSquare size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl max-w-2xl mx-auto p-4 space-y-3"
      style={{ backgroundColor: colorOf(color).bg, border: '1px solid var(--shell-border)', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
        className="w-full text-base font-semibold outline-none bg-transparent"
        style={{ color: 'var(--text-primary)' }} autoFocus />

      {!checklist ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Take a note…"
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          className="w-full text-sm outline-none bg-transparent resize-none leading-relaxed"
          style={{ color: 'var(--text-primary)' }} />
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <span className="w-4 h-4 rounded border-2 shrink-0" style={{ borderColor: 'var(--shell-border-mid)' }} />
              <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{it.text}</span>
              <button onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}
                className="p-1 rounded hover:bg-(--shell-hover-hard)">
                <X size={12} style={{ color: 'var(--text-dim)' }} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Plus size={14} style={{ color: 'var(--text-dim)' }} />
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              placeholder="List item — Enter to add"
              className="flex-1 text-sm outline-none bg-transparent" style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
      )}

      {/* Colour dots */}
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(KEEP_COLORS).map(([k, v]) => (
          <button key={k} onClick={() => setColor(k)} title={k}
            className="w-6 h-6 rounded-full transition-transform hover:scale-110"
            style={{
              backgroundColor: k === 'default' ? 'var(--ss-bg)' : v.dot,
              border: color === k ? '2px solid #C9A961' : '2px solid var(--shell-border)',
            }} />
        ))}
        <button onClick={() => setChecklist((c) => !c)}
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-(--shell-hover-hard)"
          style={{ color: checklist ? '#C9A961' : 'var(--text-muted)' }}>
          <CheckSquare size={13} /> {checklist ? 'Note mode' : 'Checklist'}
        </button>
      </div>

      {/* Due + person + actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1" style={{ borderTop: '1px solid var(--shell-border)' }}>
        <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <AlarmClock size={13} />
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg outline-none"
            style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }} />
        </label>
        {canAssignOthers && (
          <div className="w-40">
            <SearchableSelect options={options} value={forUid} onChange={setForUid} placeholder="For: Myself" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={reset} className="text-xs font-semibold px-3 py-2 rounded-lg hover:bg-(--shell-hover-hard)" style={{ color: 'var(--text-muted)' }}>
            Close
          </button>
          <button onClick={() => void submit()} disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Keep card ────────────────────────────────────────────────────────────────

function BoardHead({ Icon, label, count, color }: { Icon: typeof Inbox; label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon size={15} style={{ color }} />
      <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${color}22`, color }}>{count}</span>
    </div>
  );
}

function TaskKeepCard({ t, me, busy, now, onDone, onPatch, onOpen }: {
  t: CrmTask; me: string; busy: boolean; now: number;
  onDone: () => void; onPatch: (body: Record<string, unknown>) => void;
  onOpen?: () => void;
}) {
  const overdue = t.dueAt != null && t.dueAt.toMillis() < now;
  const mineByMe = t.createdBy === me && t.assignedTo === me;
  const items = t.items ?? [];
  const doneCount = items.filter((i) => i.done).length;
  const canTick = t.assignedTo === me || t.createdBy === me;

  const toggleItem = (id: string) => {
    if (!canTick || busy) return;
    onPatch({ items: items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) });
  };

  return (
    <div onClick={onOpen}
      className={`break-inside-avoid mb-3 rounded-2xl p-4 transition-shadow hover:shadow-lg ${onOpen ? 'cursor-pointer' : ''}`}
      title={onOpen ? 'Click to edit' : undefined}
      style={{
        backgroundColor: colorOf(t.color).bg,
        border: `1px solid ${overdue ? 'rgba(248,113,113,0.55)' : 'var(--shell-border)'}`,
      }}>
      {t.title && (
        <p className="text-sm font-bold mb-1.5 leading-snug" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
      )}
      {t.text && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{t.text}</p>
      )}

      {items.length > 0 && (
        <div className="mt-1 space-y-1">
          {items.map((it) => (
            <button key={it.id} onClick={(e) => { e.stopPropagation(); toggleItem(it.id); }} disabled={!canTick || busy}
              className="flex items-start gap-2 w-full text-left group disabled:cursor-default">
              <span className="mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: it.done ? '#34d399' : 'var(--shell-border-mid)',
                  backgroundColor: it.done ? 'rgba(52,211,153,0.18)' : 'transparent',
                }}>
                {it.done && <Check size={11} style={{ color: '#34d399' }} />}
              </span>
              <span className={`text-sm leading-snug ${it.done ? 'line-through' : ''}`}
                style={{ color: it.done ? 'var(--text-dim)' : 'var(--text-primary)' }}>
                {it.text}
              </span>
            </button>
          ))}
          <p className="text-[10px] pt-0.5" style={{ color: 'var(--text-dim)' }}>{doneCount}/{items.length} done</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3 pt-2" style={{ borderTop: '1px solid var(--shell-border)' }}>
        <p className="text-[11px] min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
          {mineByMe ? 'my task' : t.assignedTo === me ? `from ${t.createdByName}` : `to ${t.assignedToName}`}
          {t.dueAt && (
            <span className="font-medium" style={{ color: overdue ? '#f87171' : '#C9A961' }}>
              {' '}· {overdue ? 'OVERDUE' : 'due'} {fmtWhen(t.dueAt.toDate())}
            </span>
          )}
          {t.editedAt && (
            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-dim)' }}
              title={`Edited ${fmtWhen(t.editedAt.toDate())}`}>
              edited
            </span>
          )}
        </p>
        <button onClick={(e) => { e.stopPropagation(); onDone(); }} disabled={busy}
          className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
          style={{ backgroundColor: 'rgba(52,211,153,0.14)', color: '#34d399' }}>
          ✓ Done
        </button>
      </div>
    </div>
  );
}

// ─── Task edit modal — click a card to change anything on it ─────────────────

function TaskEditModal({ task, busy, onSave, onClose }: {
  task: CrmTask; busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title ?? '');
  const [text, setText] = useState(task.text ?? '');
  const [items, setItems] = useState<TaskItem[]>(task.items ?? []);
  const [newItem, setNewItem] = useState('');
  const [color, setColor] = useState(task.color ?? 'default');
  const [dueAt, setDueAt] = useState(task.dueAt ? format(task.dueAt.toDate(), "yyyy-MM-dd'T'HH:mm") : '');
  const isChecklist = items.length > 0;

  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setItems((p) => [...p, { id: `n${Date.now()}_${p.length}`, text: t, done: false }]);
    setNewItem('');
  };

  const save = async () => {
    const list = [...items, ...(newItem.trim() ? [{ id: `n${Date.now()}_x`, text: newItem.trim(), done: false }] : [])];
    await onSave({
      title: title.trim() || null,
      text: text,
      items: list.length ? list : null,
      color,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Edit task · {task.assignedTo === task.createdBy ? task.createdByName : `${task.createdByName} → ${task.assignedToName}`}
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={15} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="rounded-xl p-3.5 space-y-3" style={{ backgroundColor: colorOf(color).bg, border: '1px solid var(--shell-border)' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
            className="w-full text-base font-semibold outline-none bg-transparent"
            style={{ color: 'var(--text-primary)' }} />

          {!isChecklist && (
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Note..."
              rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
              className="w-full text-sm outline-none bg-transparent resize-none leading-relaxed"
              style={{ color: 'var(--text-primary)' }} />
          )}

          {isChecklist && (
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={it.id} className="flex items-center gap-2">
                  <button onClick={() => setItems((p) => p.map((x) => x.id === it.id ? { ...x, done: !x.done } : x))}
                    className="w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center"
                    style={{ borderColor: it.done ? '#34d399' : 'var(--shell-border-mid)', backgroundColor: it.done ? 'rgba(52,211,153,0.18)' : 'transparent' }}>
                    {it.done && <Check size={11} style={{ color: '#34d399' }} />}
                  </button>
                  <input value={it.text}
                    onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    className={`flex-1 text-sm outline-none bg-transparent ${it.done ? 'line-through' : ''}`}
                    style={{ color: it.done ? 'var(--text-dim)' : 'var(--text-primary)' }} />
                  <button onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}
                    className="p-1 rounded hover:bg-(--shell-hover-hard)">
                    <X size={12} style={{ color: 'var(--text-dim)' }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Plus size={14} style={{ color: 'var(--text-dim)' }} />
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              placeholder={isChecklist ? 'Add list item — Enter' : 'Add a checklist item to convert to a list'}
              className="flex-1 text-sm outline-none bg-transparent" style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(KEEP_COLORS).map(([k, v]) => (
            <button key={k} onClick={() => setColor(k)} title={k}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: k === 'default' ? 'var(--ss-bg)' : v.dot,
                border: color === k ? '2px solid #C9A961' : '2px solid var(--shell-border)',
              }} />
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <AlarmClock size={13} />
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg outline-none"
              style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }} />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs font-semibold px-3.5 py-2 rounded-lg hover:bg-(--shell-hover-hard)" style={{ color: 'var(--text-muted)' }}>
            Cancel
          </button>
          <button onClick={() => void save()} disabled={busy}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small link/list cards for lead actions ───────────────────────────────────

function CardSection({ Icon, label, count, color, children }: {
  Icon: typeof Inbox; label: string; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-4">
      <BoardHead Icon={Icon} label={label} count={count} color={color} />
      <div className="space-y-2">{children}</div>
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
  items: CalItem[]; busyId: string; onToggleTask: (t: CrmTask, status: 'open' | 'done') => void;
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
      <div className="glass-panel p-3 sm:p-4">
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
            if (!d) return <div key={`e${i}`} className="min-h-12 sm:min-h-16 rounded-lg" />;
            const k = dayKey(d);
            const its = byDay.get(k) ?? [];
            const isToday = k === todayKey;
            const isSelected = k === selectedDay;
            return (
              <button key={k} onClick={() => setSelectedDay(k)}
                className="min-h-12 sm:min-h-16 rounded-lg p-1 text-left align-top transition-colors hover:bg-(--shell-hover-hard)"
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
                  <button onClick={() => onToggleTask(it.task!, 'done')} disabled={busyId === it.task.id}
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
