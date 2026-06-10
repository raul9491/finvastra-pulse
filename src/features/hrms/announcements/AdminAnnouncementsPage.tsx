import { useState } from 'react';
import { format } from 'date-fns';
import { PlusCircle, Pin, PinOff, Eye, EyeOff, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllAnnouncements, createAnnouncement, toggleAnnouncementActive, updateAnnouncementPinned } from '../hooks/useAnnouncements';
import type { AnnouncementPriority } from '../../../types';

const PRIORITY_OPTIONS: { value: AnnouncementPriority; label: string }[] = [
  { value: 'normal',    label: 'Normal' },
  { value: 'important', label: 'Important' },
  { value: 'urgent',    label: 'Urgent' },
];

const PRIORITY_COLORS: Record<AnnouncementPriority, string> = {
  normal:    'var(--text-primary)',
  important: '#92400E',
  urgent:    '#BE123C',
};

function toTs(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

const inp = 'w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10 focus:border-navy';

// ─── Create Announcement Modal ────────────────────────────────────────────────

function CreateModal({ publishedBy, publishedByName, onClose }: {
  publishedBy: string; publishedByName: string; onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<AnnouncementPriority>('normal');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) { setError('Title and body are required.'); return; }
    setSaving(true); setError('');
    try {
      await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        priority,
        pinned,
        expiresAt: null,
        publishedBy,
        publishedByName,
      });
      onClose();
    } catch {
      setError('Failed to post announcement.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-(--text-primary)">New Announcement</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg)"><X size={18} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Title *</label>
            <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Body *</label>
            <textarea className={`${inp} resize-none`} rows={5} value={body}
              onChange={(e) => setBody(e.target.value)} placeholder="Announcement details…" maxLength={2000} />
            <p className="text-xs text-right text-(--text-muted) mt-1">{body.length} / 2000</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Priority</label>
              <select className={inp} value={priority} onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}>
                {PRIORITY_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Options</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="rounded" />
                <span className="text-sm text-(--text-primary)">Pin to dashboard</span>
              </label>
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {saving ? 'Posting…' : 'Post Announcement'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AdminAnnouncementsPage ───────────────────────────────────────────────────

export function AdminAnnouncementsPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? '';
  const [showCreate, setShowCreate] = useState(false);
  const { announcements, loading } = useAllAnnouncements();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Announcements — Admin
          </h2>
          <p className="text-sm text-(--text-muted)">Post and manage company-wide announcements.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          <PlusCircle size={16} />
          New Announcement
        </button>
      </div>

      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-(--glass-panel-bg) rounded-lg animate-pulse" />)}</div>
        ) : announcements.length === 0 ? (
          <div className="py-16 text-center"><p className="text-sm text-(--text-muted)">No announcements posted yet.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)">
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Title</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Priority</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Published</th>
                <th className="text-center p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Read by</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {announcements.map((a) => {
                const publishedDate = toTs(a.publishedAt);
                return (
                  <tr key={a.id} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg)/50" style={{ opacity: a.isActive ? 1 : 0.5 }}>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {a.pinned && <Pin size={13} style={{ color: '#C9A961' }} />}
                        <span className="font-medium text-(--text-primary)">{a.title}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-semibold" style={{ color: PRIORITY_COLORS[a.priority] }}>
                        {a.priority.charAt(0).toUpperCase() + a.priority.slice(1)}
                      </span>
                    </td>
                    <td className="p-4 text-(--text-muted)">{publishedDate ? format(publishedDate, 'dd MMM yyyy') : '—'}</td>
                    <td className="p-4 text-center text-(--text-muted)">{(a.readBy ?? []).length}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => updateAnnouncementPinned(a.id, !a.pinned)}
                          className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
                          title={a.pinned ? 'Unpin' : 'Pin'}>
                          {a.pinned ? <PinOff size={14} style={{ color: 'var(--text-muted)' }} /> : <Pin size={14} style={{ color: 'var(--text-muted)' }} />}
                        </button>
                        <button
                          onClick={() => toggleAnnouncementActive(a.id, !a.isActive)}
                          className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
                          title={a.isActive ? 'Deactivate' : 'Activate'}>
                          {a.isActive ? <EyeOff size={14} style={{ color: 'var(--text-muted)' }} /> : <Eye size={14} style={{ color: 'var(--text-muted)' }} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && profile && (
        <CreateModal
          publishedBy={uid}
          publishedByName={profile.displayName}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
