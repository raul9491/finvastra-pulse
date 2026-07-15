import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, CalendarClock, ListChecks, ClipboardList, Plus, PhoneCall, AlarmClock, X, Check,
} from 'lucide-react';
import {
  collection, query, where, orderBy, limit, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { PageHeader } from '../../../components/ui/primitives';
import { MyQueuePage } from '../leads/MyQueuePage';
import { MyMeetingsPage } from '../meetings/MyMeetingsPage';
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

/**
 * TasksPage — unified workspace. The To-Do tab is the "what should I act on"
 * radar: tasks assigned to you, lead follow-ups due, and customer callbacks.
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

// ─── To-Do — assigned tasks + lead follow-ups + customer callbacks ────────────

function ToDoSection() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const uid = user?.uid ?? '';
  const myFapl = profile?.employeeId ?? '';
  const canAssign = profile?.role === 'admin' || profile?.crmRole === 'manager' || isSuperAdmin(uid, profile);
  const canReadCrm2Leads = profile?.role === 'admin' || hasCrm2Perm(profile, 'crm.leads.read');

  // ── 1. Ad-hoc tasks assigned to me (live) ──────────────────────────────────
  const [myTasks, setMyTasks] = useState<CrmTask[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'crm_tasks'), where('assignedTo', '==', uid));
    return onSnapshot(q, (snap) => {
      setMyTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CrmTask));
    }, () => setMyTasks([]));
  }, [uid]);

  // Tasks I assigned to others (managers only, live)
  const [givenTasks, setGivenTasks] = useState<CrmTask[]>([]);
  useEffect(() => {
    if (!uid || !canAssign) return;
    const q = query(collection(db, 'crm_tasks'), where('createdBy', '==', uid));
    return onSnapshot(q, (snap) => {
      setGivenTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CrmTask));
    }, () => setGivenTasks([]));
  }, [uid, canAssign]);

  // ── 2. My CRM 2.0 leads → follow-ups due + awaiting first contact ──────────
  const [crm2Leads, setCrm2Leads] = useState<Crm2LeadLite[]>([]);
  useEffect(() => {
    if (!myFapl || !canReadCrm2Leads) return;
    const q = query(collection(db, 'leads'),
      where('assignedRm', '==', myFapl), orderBy('receivedAt', 'desc'), limit(300));
    return onSnapshot(q, (snap) => {
      setCrm2Leads(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Crm2LeadLite));
    }, () => setCrm2Leads([]));
  }, [myFapl, canReadCrm2Leads]);

  // ── 3. My old-CRM customer callbacks ────────────────────────────────────────
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

  // ── Derived lists ───────────────────────────────────────────────────────────
  const now = Date.now();
  const openTasks = useMemo(() =>
    myTasks.filter((t) => t.status === 'open')
      .sort((a, b) => (a.dueAt?.toMillis() ?? Infinity) - (b.dueAt?.toMillis() ?? Infinity)
        || (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [myTasks]);
  const openGiven = useMemo(() =>
    givenTasks.filter((t) => t.status === 'open')
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [givenTasks]);

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

  const [showAssign, setShowAssign] = useState(false);
  const [busyId, setBusyId] = useState('');

  const setTaskStatus = async (t: CrmTask, status: 'open' | 'done') => {
    setBusyId(t.id);
    try {
      await apiCrm2('PATCH', `/api/crm2/tasks/${t.id}`, { status });
      toast.success(status === 'done' ? 'Task marked done' : 'Task reopened');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update task');
    } finally { setBusyId(''); }
  };

  const nothingToDo = openTasks.length === 0 && followUpsDue.length === 0
    && awaitingFirstContact.length === 0 && dueCallbacks.length === 0;

  const SectionHead = ({ Icon, label, count, color }: { Icon: typeof Inbox; label: string; count: number; color: string }) => (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={15} style={{ color }} />
      <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${color}22`, color }}>{count}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {canAssign && (
        <div className="flex justify-end">
          <button onClick={() => setShowAssign(true)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> Assign a task
          </button>
        </div>
      )}

      {nothingToDo && (
        <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Nothing pending right now 🎉 — assigned tasks, lead follow-ups and customer callbacks appear here the moment they're due.
        </div>
      )}

      {/* Assigned tasks */}
      {openTasks.length > 0 && (
        <div>
          <SectionHead Icon={ClipboardList} label="Tasks assigned to me" count={openTasks.length} color="#C9A961" />
          <div className="space-y-2">
            {openTasks.map((t) => {
              const overdue = t.dueAt != null && t.dueAt.toMillis() < now;
              return (
                <div key={t.id} className="glass-panel p-3.5 flex items-start gap-3"
                  style={overdue ? { border: '1px solid rgba(248,113,113,0.4)' } : undefined}>
                  <button onClick={() => void setTaskStatus(t, 'done')} disabled={busyId === t.id}
                    className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center hover:bg-(--shell-hover-hard) transition-colors disabled:opacity-40"
                    style={{ borderColor: overdue ? '#f87171' : 'var(--shell-border-mid)' }}
                    title="Mark done">
                    <Check size={12} style={{ color: 'transparent' }} className="hover:!text-current" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{t.text}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      from {t.createdByName}
                      {t.dueAt && (
                        <span style={{ color: overdue ? '#f87171' : '#C9A961' }}>
                          {' '}· due {fmtWhen(t.dueAt.toDate())}{overdue ? ' — OVERDUE' : ''}
                        </span>
                      )}
                      {t.link && <> · <Link to={t.link} className="underline hover:opacity-80" style={{ color: '#C9A961' }}>open link →</Link></>}
                    </p>
                  </div>
                  <button onClick={() => void setTaskStatus(t, 'done')} disabled={busyId === t.id}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                    style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                    ✓ Done
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead follow-ups due (CRM 2.0) */}
      {followUpsDue.length > 0 && (
        <div>
          <SectionHead Icon={AlarmClock} label="Lead follow-ups due" count={followUpsDue.length} color="#fbbf24" />
          <div className="space-y-2">
            {followUpsDue.map((l) => {
              const at = l.nextFollowUpAt!.toDate();
              const overdue = at.getTime() < now;
              return (
                <Link key={l.id} to="/crm/pipeline/leads"
                  className="glass-panel p-3.5 flex items-start gap-3 hover:bg-(--shell-hover-soft) transition-colors"
                  style={overdue ? { border: '1px solid rgba(248,113,113,0.4)' } : undefined}>
                  <AlarmClock size={16} className="shrink-0 mt-0.5" style={{ color: overdue ? '#f87171' : '#fbbf24' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{l.name ?? l.leadCode ?? l.id}</p>
                    <p className="text-[11px]" style={{ color: overdue ? '#f87171' : 'var(--text-muted)' }}>
                      Follow up {overdue ? 'was due' : 'due'} {fmtWhen(at)}
                      {l.nextFollowUpNote ? ` — ${l.nextFollowUpNote}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold" style={{ color: '#C9A961' }}>Open →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* New leads awaiting first contact (CRM 2.0) */}
      {awaitingFirstContact.length > 0 && (
        <div>
          <SectionHead Icon={PhoneCall} label="New leads — make the first call" count={awaitingFirstContact.length} color="#60a5fa" />
          <div className="space-y-2">
            {awaitingFirstContact.slice(0, 15).map((l) => (
              <Link key={l.id} to="/crm/pipeline/leads"
                className="glass-panel p-3.5 flex items-start gap-3 hover:bg-(--shell-hover-soft) transition-colors">
                <PhoneCall size={16} className="shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{l.name ?? l.leadCode ?? l.id}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Assigned to you{l.receivedAt ? ` · received ${fmtWhen(l.receivedAt.toDate())}` : ''} — not contacted yet
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold" style={{ color: '#C9A961' }}>Open →</span>
              </Link>
            ))}
            {awaitingFirstContact.length > 15 && (
              <Link to="/crm/pipeline/leads" className="block text-center text-xs py-2 underline" style={{ color: 'var(--text-muted)' }}>
                +{awaitingFirstContact.length - 15} more on the Leads page →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Customer callbacks (old CRM) */}
      {dueCallbacks.length > 0 && (
        <div>
          <SectionHead Icon={PhoneCall} label="Customer callbacks scheduled" count={dueCallbacks.length} color="#34d399" />
          <div className="space-y-2">
            {dueCallbacks.map((l) => {
              const at = new Date(l.callbackAt!);
              const overdue = at.getTime() < now;
              return (
                <Link key={l.id} to={`/crm/leads/${l.id}`}
                  className="glass-panel p-3.5 flex items-start gap-3 hover:bg-(--shell-hover-soft) transition-colors"
                  style={overdue ? { border: '1px solid rgba(248,113,113,0.4)' } : undefined}>
                  <PhoneCall size={16} className="shrink-0 mt-0.5" style={{ color: overdue ? '#f87171' : '#34d399' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{l.displayName ?? l.id}</p>
                    <p className="text-[11px]" style={{ color: overdue ? '#f87171' : 'var(--text-muted)' }}>
                      Callback {overdue ? 'was due' : 'scheduled'} {fmtWhen(at)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold" style={{ color: '#C9A961' }}>Open →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Tasks I assigned (managers) */}
      {canAssign && openGiven.length > 0 && (
        <div>
          <SectionHead Icon={ListChecks} label="Tasks I assigned (open)" count={openGiven.length} color="#8B5CF6" />
          <div className="space-y-2">
            {openGiven.map((t) => (
              <div key={t.id} className="glass-panel p-3.5 flex items-start gap-3">
                <ListChecks size={16} className="shrink-0 mt-0.5" style={{ color: '#8B5CF6' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{t.text}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    to {t.assignedToName}
                    {t.dueAt && ` · due ${fmtWhen(t.dueAt.toDate())}`}
                  </p>
                </div>
                <button onClick={() => void setTaskStatus(t, 'done')} disabled={busyId === t.id}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                  style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                  ✓ Done
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAssign && <AssignTaskModal onClose={() => setShowAssign(false)} />}
    </div>
  );
}

// ─── Assign-task modal (manager / admin / super admin) ────────────────────────

function AssignTaskModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { employees } = useAllEmployees();
  const [assignedTo, setAssignedTo] = useState('');
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const options = employees
    .filter((e) => !e.employeeStatus || e.employeeStatus === 'active')
    .map((e) => ({ value: e.userId, label: e.displayName }));

  const submit = async () => {
    if (!assignedTo) { setErr('Pick who this task is for'); return; }
    if (text.trim().length < 5) { setErr('Describe the task (min 5 characters)'); return; }
    setErr(''); setSaving(true);
    try {
      await apiCrm2('POST', '/api/crm2/tasks', {
        assignedTo,
        text: text.trim(),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      toast.success('Task assigned — they\'ve been notified');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign the task');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="glass-modal-panel rounded-2xl w-full max-w-md p-6 space-y-4" style={{ backgroundColor: 'var(--ss-bg)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Assign a task</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={16} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Assign to *</label>
          <SearchableSelect options={options} value={assignedTo} onChange={setAssignedTo} placeholder="Search by name…" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Task *</label>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            className="w-full text-sm px-3.5 py-2.5 rounded-xl outline-none focus:ring-2 resize-none"
            style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}
            placeholder="e.g. Call the Sharma HL lead today and confirm the documents list" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Due (optional)</label>
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
            className="w-full text-sm px-3.5 py-2.5 rounded-xl outline-none focus:ring-2"
            style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg" style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {saving ? 'Assigning…' : 'Assign & notify'}
          </button>
        </div>
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
