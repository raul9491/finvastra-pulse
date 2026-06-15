import { useState } from 'react';
import { Inbox, CalendarClock, ListChecks } from 'lucide-react';
import { MyQueuePage } from '../leads/MyQueuePage';
import { MyMeetingsPage } from '../meetings/MyMeetingsPage';

type Tab = 'queue' | 'meetings';

/**
 * TasksPage — Phase 1 unified workspace housing My Queue + Meetings under one
 * "Tasks" tab. Case-pending tasks and RM/manager collaboration land in Phase 6.
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
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Tasks
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your queue, meetings and follow-ups in one place.</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
        <TabBtn id="queue" label="My Queue" Icon={Inbox} />
        <TabBtn id="meetings" label="Meetings" Icon={CalendarClock} />
      </div>

      <div>
        {tab === 'queue' ? <MyQueuePage /> : <MyMeetingsPage />}
      </div>

      <div className="glass-panel p-4 flex items-start gap-3" style={{ borderStyle: 'dashed' }}>
        <ListChecks size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <strong>Coming soon:</strong> pending tasks per case and a collaboration thread when you share a case with a teammate or manager (Phase 6).
        </p>
      </div>
    </div>
  );
}
