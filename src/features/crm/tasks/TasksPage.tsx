import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, CalendarClock, ListChecks } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';
import { MyQueuePage } from '../leads/MyQueuePage';
import { MyMeetingsPage } from '../meetings/MyMeetingsPage';
import { apiCrm2 } from '../../crm2/lib';

type Tab = 'queue' | 'meetings' | 'cases';

type CaseTask = { id: string; caseId: string; clientName: string | null; text: string; createdByName: string; createdAt: number | null };

/**
 * TasksPage — unified workspace: My Queue + Meetings + (Phase 6) case tasks
 * assigned to me across all shared cases (collaboration thread feed).
 */
export function TasksPage() {
  const [tab, setTab] = useState<Tab>('queue');

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
        <TabBtn id="queue" label="My Queue" Icon={Inbox} />
        <TabBtn id="meetings" label="Meetings" Icon={CalendarClock} />
        <TabBtn id="cases" label="Case Tasks" Icon={ListChecks} />
      </div>

      <div>
        {tab === 'queue' ? <MyQueuePage /> : tab === 'meetings' ? <MyMeetingsPage /> : <CaseTasksSection />}
      </div>
    </div>
  );
}

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
